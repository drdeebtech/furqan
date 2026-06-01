-- 20260601084448_fix_package_deduct_restore_pin_to_booking_pkg.sql
--
-- Audit finding H17: restore_student_package() re-derived a "soonest-expiry"
-- package on cancellation instead of crediting the package that was actually
-- charged. deduct_student_package() picks soonest-expiry-among-active; restore
-- picks soonest-expiry-among-used>0 — after multiple purchases these diverge,
-- so a cancellation can credit a DIFFERENT package than was debited (money bug).
--
-- Root cause detail: the 1:1 booking-create path
-- (src/lib/domains/booking/actions.ts) never sets bookings.student_package_id,
-- so there was no record of which package a booking charged. Group/class
-- bookings DO set it at insert and deduct via the explicit
-- deduct_package_session(uuid) RPC — and they are inserted status='confirmed'
-- (no pending->confirmed UPDATE), so these AFTER UPDATE OF status triggers
-- never fire for them (no double-deduct).
--
-- Fix: make deduct STAMP the chosen package onto bookings.student_package_id,
-- and make restore CREDIT that exact stamped package. Both triggers keep their
-- existing status-transition guards (idempotent: a repeat same-status UPDATE
-- does not fire). The stamp-back UPDATE changes student_package_id only (not
-- status), so it does not re-fire these `AFTER UPDATE OF status` triggers.

-- ─── deduct on confirmation (pending -> confirmed) ──────────────────────────
create or replace function public.deduct_student_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg uuid;
begin
  if new.status = 'confirmed' and old.status = 'pending' then
    -- Only the 1:1 path reaches here (group/class insert as 'confirmed' and
    -- deduct via RPC). If student_package_id is already set, the charge was
    -- handled elsewhere — do nothing to avoid double-deduct.
    if new.student_package_id is not null then
      return new;
    end if;

    select id into v_pkg
    from student_packages
    where student_id = new.student_id
      and status = 'active'
      and sessions_used < sessions_total
      and (expires_at is null or expires_at > now())
    order by expires_at asc nulls last, purchased_at asc
    limit 1
    for update skip locked;

    if v_pkg is not null then
      update student_packages
      set sessions_used = sessions_used + 1
      where id = v_pkg;

      -- Stamp the charged package onto the booking so restore credits the
      -- SAME package (audit H17). Touches student_package_id only — does not
      -- change status, so this UPDATE does not re-fire the status triggers.
      update bookings
      set student_package_id = v_pkg
      where id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- ─── restore on cancellation (confirmed -> cancelled) ───────────────────────
create or replace function public.restore_student_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg uuid;
begin
  if new.status = 'cancelled' and old.status = 'confirmed' then
    -- Credit the exact package that was charged (stamped by deduct, or set at
    -- insert for group/class). Fall back to soonest-expiry only for legacy
    -- rows with no recorded package.
    if new.student_package_id is not null then
      v_pkg := new.student_package_id;
    else
      select id into v_pkg
      from student_packages
      where student_id = new.student_id
        and sessions_used > 0
      order by expires_at asc nulls last, purchased_at asc
      limit 1
      for update skip locked;
    end if;

    if v_pkg is not null then
      update student_packages
      set sessions_used = greatest(sessions_used - 1, 0)
      where id = v_pkg
        and sessions_used > 0;   -- clamp guard: never restore below 0
    end if;
  end if;
  return new;
end;
$$;

-- Triggers already exist (t_deduct_student_package / t_restore_student_package,
-- AFTER UPDATE OF status). create-or-replace of the functions is sufficient;
-- no trigger re-wiring needed.

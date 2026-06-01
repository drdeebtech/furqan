-- 20260601164428_route_package_debit_through_kernel.sql
--
-- Architecture deepening (Package ledger, candidate #1): consolidate the
-- session-credit DEBIT mutation onto ONE canonical kernel.
--
-- Before this migration the "increment sessions_used" rule lived in two places:
--   1. deduct_package_session(uuid)  -- the kernel: increments with the
--      active / sessions_used<sessions_total / not-expired guard. Called by the
--      group, class and instant-session paths.
--   2. deduct_student_package()      -- the 1:1 booking-confirm trigger, which
--      RE-IMPLEMENTED the same `sessions_used = sessions_used + 1` UPDATE inline
--      after selecting the soonest-expiry package.
--
-- Two copies of a money mutation is exactly the shape that produced audit H17
-- (#346) and #363 — the rule disagreeing with itself across call sites.
--
-- Fix: the trigger now selects the soonest-expiry active package (unchanged) and
-- DELEGATES the decrement to deduct_package_session(v_pkg). The H17 stamp
-- (bookings.student_package_id = v_pkg) is preserved. Behaviour is identical —
-- the kernel re-checks the same predicates the SELECT ... FOR UPDATE already
-- guaranteed in this transaction — but the increment now lives in exactly one
-- place that every debit path shares.
--
-- SCOPE: debit side only. The credit trigger restore_student_package() is owned
-- by the open PR #363/#364 (null-stamp guard) and is intentionally NOT touched
-- here to avoid a conflicting third version. Routing the credit trigger through
-- refund_package_session() is a follow-up once #364 lands.

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
    -- deduct via the deduct_package_session RPC). If student_package_id is
    -- already set, the charge was handled elsewhere — do nothing (no double
    -- deduct). Guard retained from #346.
    if new.student_package_id is not null then
      return new;
    end if;

    -- Pick the soonest-expiry active package with credit remaining. FOR UPDATE
    -- SKIP LOCKED keeps concurrent confirms from racing onto the same package.
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
      -- Delegate the decrement to the canonical kernel (one mutation rule for
      -- every debit path). Returns true when a row was charged; the row is
      -- already locked above and matches the kernel's guard, so this succeeds.
      if deduct_package_session(v_pkg) then
        -- Stamp the charged package onto the booking so restore credits the
        -- SAME package (audit H17). Touches student_package_id only — not
        -- status — so this UPDATE does not re-fire the status triggers.
        update bookings
        set student_package_id = v_pkg
        where id = new.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

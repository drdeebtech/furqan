-- 20260601133511_restore_pkg_no_credit_on_null_stamp.sql
--
-- Audit follow-up #363 (surfaced while landing #346 / H17): the legacy
-- "soonest-expiry among sessions_used > 0" fallback in restore_student_package()
-- can credit a package that was NEVER charged for this booking, handing out a
-- free session.
--
-- Scenario it fixes: a 1:1 booking is confirmed while the student has no active
-- package (e.g. it was covered by a student_credit, was admin-created, or was
-- genuinely free). deduct_student_package() debits nothing and leaves
-- bookings.student_package_id NULL. On later cancel, the old fallback would
-- re-derive an unrelated package and credit it.
--
-- Why a NULL stamp now reliably means "no package was charged":
-- after #346 (20260601084448), deduct_student_package() STAMPS the charged
-- package onto bookings.student_package_id whenever it debits one, and the
-- group/class path sets student_package_id at insert. So a package is debited
-- IFF the booking is stamped. Therefore NULL stamp => nothing was debited =>
-- there is nothing to restore. Guessing a package is always wrong here.
--
-- Fix: drop the fallback. When student_package_id is NULL, credit nothing.
-- The exact-stamp path (the real #346 fix) is unchanged.
--
-- Legacy exposure at deploy time: 5 confirmed 1:1 rows have a NULL stamp and
-- NONE of those students hold a sessions_used > 0 package, so the old fallback
-- already credited nothing for them -- this change harms no existing row. The
-- pre-#346 package charged by a legacy row is not recoverable from the schema,
-- so a backfill is neither possible nor warranted; genuine legacy refunds are
-- handled by admin tooling, not by guessing.
--
-- NOTE: the inverse invariant ("block confirm when no active package") is NOT
-- enforced on purpose -- a 1:1 booking may legitimately be paid by a
-- student_credit (deduct_student_credit fires on the same pending->confirmed),
-- so raising in deduct_student_package() would break credit-funded bookings.

create or replace function public.restore_student_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status = 'confirmed' then
    -- Credit ONLY the exact package that was charged (stamped on deduct by
    -- #346, or set at insert for group/class). A NULL stamp means no package
    -- was debited for this booking, so there is nothing to restore -- do not
    -- re-derive a package (that would be a free session credit, #363).
    if new.student_package_id is not null then
      update student_packages
      set sessions_used = greatest(sessions_used - 1, 0)
      where id = new.student_package_id
        and sessions_used > 0;   -- clamp guard: never restore below 0
    end if;
  end if;
  return new;
end;
$$;

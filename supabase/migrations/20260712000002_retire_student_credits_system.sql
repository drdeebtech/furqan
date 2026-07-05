-- expand-contract-ok: retiring the fully-dead legacy student_credits system.
--
-- The legacy per-session "credits" ledger was superseded by student_packages.
-- No application code reads or writes student_credits (the only src/ reference
-- is a table-name string in rls.test.ts); its two trigger functions
-- (deduct/restore) have no live caller, and after 20260712000001 dropped the
-- deduct trigger only the harmless restore trigger remains. This migration
-- removes the whole dead system so the double-decrement class is gone for good.
--
-- SELF-GUARD (make-no-mistake): rather than trust a point-in-time manual row
-- count, the migration refuses to drop the table if it holds ANY row when it
-- actually runs. If prod unexpectedly still has legacy credit rows, the DO block
-- raises, the whole migration transaction rolls back (nothing dropped, no data
-- lost), and the failed migration loudly flags it for review. Expected path
-- (table empty everywhere — verified locally + by code) is a clean removal.
do $$
begin
  if exists (select 1 from public.student_credits limit 1) then
    raise exception
      'student_credits is not empty — aborting legacy cleanup for review. No data dropped (migration rolled back).';
  end if;
end $$;

drop trigger  if exists t_restore_student_credit on public.bookings;
drop trigger  if exists t_deduct_student_credit  on public.bookings;  -- idempotent: already dropped in 20260712000001
drop function if exists public.restore_student_credit() cascade;
drop function if exists public.deduct_student_credit()  cascade;
drop table    if exists public.student_credits;

-- 20260601103511_consolidate_homework_update_triggers.sql
-- Closes #324.
--
-- homework_assignments carried TWO before-update triggers:
--   - validate_homework_status            (BEFORE UPDATE OF status) — #233
--   - guard_completed_homework_immutable  (BEFORE UPDATE, all cols)  — #234
-- Because `guard` fires on every update and `validate` fires on every status
-- update, a status change evaluated BOTH. At 50k DAU the nightly homework
-- batch (~10M status rows/night) ran ~20M trigger evaluations.
--
-- This collapses them into ONE before-update function with identical
-- behaviour, halving the eval count on the hot path (20M → 10M/night):
--   1. Admin bypass (is_admin()) — unchanged.
--   2. Completed rows are immutable to non-admins for ANY column change
--      (the old `guard` rule — fires on every update).
--   3. When status actually changes, enforce the valid-transition matrix
--      (the old `validate` rule).
--
-- Equivalence notes vs. the two originals:
--   - A status change on a completed row was previously rejected by both
--     triggers (terminal-state + immutable); now rejected once by rule 2.
--     Same outcome, single error message.
--   - Non-status updates to non-completed rows fired only `guard` before and
--     pass rule 2; rule 3 is skipped (status unchanged). Same outcome.
--   - `validate`'s `OF status` scoping was never a real reduction because
--     `guard` already fired on every update — so total fires drop from 2→1
--     on status updates and stay 1 on other updates.

create or replace function enforce_homework_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins can force any transition / correct graded rows.
  if is_admin() then
    return new;
  end if;

  -- Completed homework is immutable to non-admins — blocks ANY column change
  -- (former guard_completed_homework_immutable, #234).
  if old.status in (
    'completed_excellent',
    'completed_good',
    'completed_needs_work',
    'completed_not_done'
  ) then
    raise exception
      'homework % is completed and immutable; use admin override to correct',
      old.id
      using errcode = 'P0001';
  end if;

  -- Validate status transitions, only when status actually changes
  -- (former validate_homework_status, #233).
  if new.status is distinct from old.status then
    if old.status = 'assigned' and new.status not in ('assigned', 'student_ready') then
      raise exception
        'invalid homework status transition: % → %',
        old.status, new.status
        using errcode = 'P0001';
    end if;

    if old.status = 'student_ready' and new.status not in (
      'student_ready',
      'completed_excellent',
      'completed_good',
      'completed_needs_work',
      'completed_not_done'
    ) then
      raise exception
        'invalid homework status transition: % → %',
        old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- Replace the two old triggers with the single consolidated one.
drop trigger if exists validate_homework_status on homework_assignments;
drop trigger if exists guard_completed_homework_immutable on homework_assignments;

drop trigger if exists enforce_homework_update_rules on homework_assignments;
create trigger enforce_homework_update_rules
  before update
  on homework_assignments
  for each row
  execute function enforce_homework_update_rules();

-- Drop the now-orphaned functions (no remaining trigger references them).
drop function if exists validate_homework_status();
drop function if exists guard_completed_homework_immutable();

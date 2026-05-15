-- 20260515131637_validate_homework_status_trigger.sql
-- Closes #233.
-- DB-level guard on homework_assignments status transitions.
-- Mirrors the validate_booking_status pattern on the bookings table.
-- Valid transitions:
--   assigned        → student_ready
--   student_ready   → completed_excellent | completed_good |
--                      completed_needs_work | completed_not_done
--   completed_*     → TERMINAL (no change allowed)
-- Admin bypass: is_admin() skips the guard to allow corrections.

create or replace function validate_homework_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins can force any transition.
  if is_admin() then
    return new;
  end if;

  -- Terminal states are immutable.
  if old.status in (
    'completed_excellent',
    'completed_good',
    'completed_needs_work',
    'completed_not_done'
  ) then
    raise exception
      'homework % is in terminal state % and cannot be updated',
      old.id, old.status
      using errcode = 'P0001';
  end if;

  -- Guard valid transitions.
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

  return new;
end;
$$;

drop trigger if exists validate_homework_status on homework_assignments;

create trigger validate_homework_status
  before update of status
  on homework_assignments
  for each row
  execute function validate_homework_status();

-- 20260515131638_guard_completed_homework_immutable.sql
-- Closes #234.
-- Prevent ANY column update to completed homework rows at the DB level.
-- The application layer already enforces this in editHomework; this trigger is
-- the safety net for direct SQL, migrations, and future code paths.
-- Admin bypass: is_admin() allows corrections to graded rows when needed.

create or replace function guard_completed_homework_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;

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

  return new;
end;
$$;

drop trigger if exists guard_completed_homework_immutable on homework_assignments;

create trigger guard_completed_homework_immutable
  before update
  on homework_assignments
  for each row
  execute function guard_completed_homework_immutable();

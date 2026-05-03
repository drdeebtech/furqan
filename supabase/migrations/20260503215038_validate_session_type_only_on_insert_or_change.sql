-- 20260503215038_validate_session_type_only_on_insert_or_change.sql
--
-- Scope `validate_session_type()` so it only runs on INSERT or when
-- teacher_id / session_type actually changes on UPDATE. Previously it
-- re-validated on every UPDATE, including pure status flips like
-- 'confirmed' -> 'completed'. That broke the auto-complete-sessions cron
-- (Sentry JAVASCRIPT-NEXTJS-E4-R) — when a teacher's specialties had
-- narrowed since the booking was made, the cron's status update was
-- rejected with "Teacher does not offer session type: <X>", leaving
-- stranded sessions un-closed and accumulating in the dashboard.
--
-- The validation is still meaningful at INSERT (a new booking must match
-- a current offering) and on teacher_id/session_type changes (rebooking).
-- A status flip on an existing booking is not a meaningful change for
-- this rule and should not be blocked.
--
-- Idempotent: CREATE OR REPLACE FUNCTION leaves the trigger binding intact.

create or replace function public.validate_session_type()
returns trigger
language plpgsql
as $$
declare
  teacher_specialties text[];
begin
  -- Only validate when the booking is new, or when the columns the rule
  -- actually depends on changed. Pure status / metadata updates pass through.
  if tg_op = 'UPDATE'
     and new.teacher_id is not distinct from old.teacher_id
     and new.session_type is not distinct from old.session_type
  then
    return new;
  end if;

  select specialties into teacher_specialties
  from teacher_profiles
  where teacher_id = new.teacher_id;

  if teacher_specialties is not null
     and array_length(teacher_specialties, 1) > 0
     and not (new.session_type::text = any(teacher_specialties))
  then
    raise exception 'Teacher does not offer session type: %', new.session_type;
  end if;
  return new;
end;
$$;

-- 20260613140000_guard_booking_identity_change.sql
--
-- P0 security fix (spec 017 §T2): block non-admin / non-service-role actors
-- from rewriting a booking's teacher_id or student_id on an existing row.
--
-- Exploit being closed: `bookings_update` RLS policy is
--   USING (auth.uid()=student_id OR auth.uid()=teacher_id OR is_admin())
-- with an empty WITH CHECK. A student owning a pending booking could do a
-- same-status UPDATE setting teacher_id = auth.uid() and
-- student_id = <victim> (passes USING via the old student_id, empty WITH
-- CHECK, status unchanged so validate_booking_status never fires), then
-- UPDATE status → confirmed (now passes USING via the new teacher_id and
-- the old.teacher_id actor guard) → deduct_student_package fires for the
-- victim's package. The spec-012 actor guard (block_student_booking_self_confirm)
-- is bypassed because teacher_id/student_id are themselves mutable.
--
-- Verified pre-fix: no app path ever UPDATEs bookings.teacher_id/student_id
-- on an existing row — booking parties are fixed at INSERT; admin
-- reassignment would be a service-role write. So locking them is safe.
--
-- Fix (mirrors 20260612120000_guard_profiles_role_escalation.sql): a
-- BEFORE UPDATE OF teacher_id, student_id trigger raises 42501 when either
-- identity column changes, unless the caller is service_role, an admin, or
-- a direct-DB write (NULL JWT). SECURITY DEFINER so private.is_admin() runs
-- with elevated privileges and is not blocked by this trigger.

create or replace function private.guard_booking_identity_change()
returns trigger
language plpgsql
security definer
set search_path TO 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if (new.teacher_id is distinct from old.teacher_id
      or new.student_id is distinct from old.student_id)
     and v_jwt_role is not null            -- NULL => direct DB / migration, trusted
     and v_jwt_role <> 'service_role'      -- trusted server actions
     and not private.is_admin()            -- admin via own session
  then
    raise exception 'only an admin may change booking parties'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.guard_booking_identity_change() owner to postgres;

drop trigger if exists t_guard_booking_identity_change on public.bookings;

create trigger t_guard_booking_identity_change
  before update of teacher_id, student_id on public.bookings
  for each row
  execute function private.guard_booking_identity_change();

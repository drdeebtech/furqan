-- Spec 012 P1 2.1: block student self-confirm of bookings
--
-- validate_booking_status() enforces the transition state-machine but does not
-- check *who* is performing the transition.  RLS bookings_update lets a student
-- update their own row, so a student can self-transition pending→confirmed,
-- bypassing teacher confirmation.
--
-- Fix: add an actor guard for the →confirmed transition.  Only service_role
-- (all app confirm paths use createAdminClient) or the booking's teacher may
-- confirm.  Admin is already short-circuited above.  Student cancel
-- (pending→cancelled) remains allowed.

create or replace function public.validate_booking_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.status = new.status then return new; end if;
  if is_admin() then return new; end if;

  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    if not (
      coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or (select auth.uid()) = new.teacher_id
    ) then
      raise exception 'only the teacher may confirm a booking' using errcode = '42501';
    end if;
  end if;

  if old.status = 'pending' and new.status in ('confirmed', 'cancelled') then
    return new;
  elsif old.status = 'confirmed' and new.status in ('completed', 'cancelled', 'no_show') then
    return new;
  else
    raise exception 'Invalid status transition: % to %', old.status, new.status;
  end if;
end;
$function$;

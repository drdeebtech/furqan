-- Atomic booking confirmation: UPDATE bookings.status='confirmed' + INSERT
-- sessions row in one transaction. Companion to the cross-domain orchestrator
-- in src/lib/domains/booking/orchestrate.ts (ADR-0004).
--
-- Why a Postgres function (and not two client calls):
--   The previous teacher-route flow could leave bookings.status='confirmed'
--   without a corresponding sessions row when the sessions INSERT failed
--   after the UPDATE committed. The user saw a "تم تأكيد الحجز لكن فشل تسجيل
--   الجلسة" warning and the platform carried a half-confirmed booking
--   indefinitely. Doing both writes inside a single SQL function makes
--   them transactional — either both commit or neither does.
--
-- Pattern mirrors the existing deduct_package_session(uuid) function
-- (CLAUDE.md "SQL Functions") and the recent deduct_package_session_mode
-- (20260505211356).
--
-- Out of scope for this function (lives at the orchestrator):
--   - Daily.co createRoom — external API, cannot be transactional with DB
--   - Best-effort notify(student) and emitEvent("booking.confirmed") —
--     run after this function returns successfully

create or replace function public.confirm_booking_with_session(
  p_booking_id uuid,
  p_room_url text,
  p_room_name text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_updated_count int;
begin
  -- 1. Confirm the booking — succeeds only if currently in 'pending' status.
  --    teacher_confirmed / teacher_confirmed_at match the V9 flow the route
  --    adapter set inline before this function existed.
  update public.bookings
  set
    status = 'confirmed',
    teacher_confirmed = true,
    teacher_confirmed_at = now()
  where id = p_booking_id
    and status = 'pending';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    -- Either the booking doesn't exist or is not in 'pending' state.
    -- The orchestrator pre-reads the booking before calling this, so a
    -- 'booking_not_pending' raise here means a race lost (someone else
    -- transitioned the booking between the orchestrator's pre-read and
    -- this UPDATE). The orchestrator translates this into
    -- BookingAlreadyConfirmedError.
    raise exception 'booking_not_pending'
      using errcode = 'P0001',
            detail = 'booking ' || p_booking_id || ' is not in pending state';
  end if;

  -- 2. Insert the sessions row in the same transaction. If this fails
  --    (e.g., FK violation, duplicate booking_id, NOT NULL on a column
  --    we forgot), the bookings UPDATE above rolls back — no orphaned
  --    status='confirmed' booking with a missing sessions row.
  insert into public.sessions (
    booking_id,
    room_name,
    room_url,
    expires_at,
    created_via
  )
  values (
    p_booking_id,
    p_room_name,
    p_room_url,
    p_expires_at,
    'auto'
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

-- Tighten EXECUTE per the 2026-04-28 hardening sweep
-- (20260428095637_hardening_security_definer_and_rls.sql). Only the
-- service_role client (createAdminClient()) calls this — the orchestrator
-- runs with service-role credentials.
revoke all on function public.confirm_booking_with_session(uuid, text, text, timestamptz) from public;
grant execute on function public.confirm_booking_with_session(uuid, text, text, timestamptz) to service_role;

comment on function public.confirm_booking_with_session(uuid, text, text, timestamptz) is
  'Atomic booking confirmation. UPDATE bookings.status=''confirmed'' + INSERT sessions in one transaction. Raises ''booking_not_pending'' (errcode P0001) when the booking is not currently pending. Called by src/lib/domains/booking/orchestrate.ts confirmBooking(). See ADR-0004.';

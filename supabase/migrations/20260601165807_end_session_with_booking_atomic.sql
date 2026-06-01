-- 20260601165807_end_session_with_booking_atomic.sql
--
-- Companion to the session-end use-case orchestrator
-- (src/lib/domains/session/orchestrate.ts, ADR-0004 — session-end is the
-- next named pilot after confirmBooking).
--
-- Atomic critical path for ending a session: UPDATE sessions (ended_at +
-- actual_duration) + UPDATE bookings.status='completed' in ONE transaction.
--
-- Why a Postgres function (and not two client calls): the two prior inline
-- implementations (teacher endSession, admin forceEndSession) ran the writes
-- sequentially in OPPOSITE orders, each with a comment fearing a partial
-- failure (a session ended with the booking stuck 'confirmed', or vice versa).
-- Doing both writes inside one SQL function makes them transactional — either
-- both commit or neither does — and removes the ordering question entirely.
--
-- Pattern mirrors confirm_booking_with_session (20260508011953) and
-- deduct_package_session.
--
-- Idempotency / race-safety: the sessions UPDATE is guarded by `ended_at is
-- null`, so a second call (e.g. the Daily webhook ended it first, or a double
-- click) updates zero rows and the function raises 'session_already_ended'.
-- The orchestrator pre-reads ended_at and short-circuits, so this raise only
-- fires on a genuine race; it translates the raise into an idempotent
-- already-ended result, never a user-facing error.
--
-- Out of scope (lives at the orchestrator, best-effort post-commit):
--   notify(student) + notify(parent) + notify(teacher-if-forced) +
--   emitEvent("session.ended") + the diff audit row.

create or replace function public.end_session_with_booking(
  p_session_id uuid,
  p_actual_duration int
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_ended_at timestamptz := now();
  v_count int;
begin
  -- 1. End the session — succeeds only if not already ended. Capture the
  --    booking id from the same row so we don't need a second read.
  update public.sessions
  set ended_at = v_ended_at,
      actual_duration = p_actual_duration
  where id = p_session_id
    and ended_at is null
  returning booking_id into v_booking_id;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    -- Already ended (webhook / double-fire) or the session does not exist.
    -- The orchestrator pre-reads ended_at, so reaching here means a race was
    -- lost; it maps this to an idempotent already-ended result.
    raise exception 'session_already_ended'
      using errcode = 'P0001',
            detail = 'session ' || p_session_id || ' is already ended or does not exist';
  end if;

  -- sessions.booking_id is nullable. A session with no booking has nothing to
  -- complete — failing here keeps the "session + booking in one transaction"
  -- guarantee honest (the session UPDATE above rolls back too) rather than
  -- silently ending the session while completing zero booking rows.
  if v_booking_id is null then
    raise exception 'session_without_booking'
      using errcode = 'P0001',
            detail = 'session ' || p_session_id || ' has no booking_id to complete';
  end if;

  -- 2. Complete the booking. Guarded so a re-completion is a no-op rather than
  --    re-firing the confirmed->completed work (e.g. t_inc_teacher_sessions).
  update public.bookings
  set status = 'completed'
  where id = v_booking_id
    and status <> 'completed';

  return v_ended_at;
end;
$$;

-- Lock down EXECUTE: this is SECURITY DEFINER (runs as owner, bypasses RLS), so
-- it must not be callable by end-user roles — otherwise it is an authorization-
-- bypass primitive to end arbitrary sessions. Mirror confirm_booking_with_session
-- (migration 20260508011953): revoke from public, grant only to service_role.
revoke all on function public.end_session_with_booking(uuid, int) from public;
grant execute on function public.end_session_with_booking(uuid, int) to service_role;

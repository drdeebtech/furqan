-- Fail-closed confirm: never grant a free 1:1 session.
--
-- Context (money-critical):
--   `confirm_booking_with_session(uuid,text,text,timestamptz)` is the ONLY 1:1
--   pending->confirmed writer (called from src/lib/domains/booking/orchestrate.ts).
--   The AFTER UPDATE OF status trigger `t_deduct_student_package` runs
--   `deduct_student_package()` to debit a package on that transition. When the
--   student has NO active package with credit, the trigger SILENTLY no-ops:
--   the booking still flips to 'confirmed' = a FREE session, no error, no audit.
--   Once Stripe is live this is a revenue leak.
--
-- Fix:
--   After the status flip (so the AFTER trigger has already run and stamped
--   bookings.student_package_id when it charged a package), re-read the booking.
--   If it is a paid 1:1 (amount_usd > 0) that was NOT charged to a package
--   (student_package_id IS NULL), RAISE — rolling back the whole RPC
--   transaction. The booking stays 'pending'; no session row is created.
--
-- Why this is the right boundary:
--   - The deduct trigger is AFTER UPDATE OF status, so within the same
--     statement the trigger has fired and committed its UPDATE of
--     student_package_id by the time control returns to this function's next
--     statement. A fresh SELECT here therefore observes whether a package was
--     charged. RAISE in this function aborts the transaction → the trigger's
--     UPDATE and the status flip both roll back. No free session can commit.
--
-- Exemption (documented assumption):
--   The guard only blocks `amount_usd > 0` bookings. Today this exempts NOTHING
--   that can actually exist: the bookings table has a CHECK constraint
--   `bookings_amount_usd_check` (amount_usd > 0), so every 1:1 booking is paid.
--   The amount_usd>0 predicate is kept as defense-in-depth so that IF a future
--   migration introduces genuinely-free 1:1 bookings (trial/comp, amount_usd=0)
--   they pass through without a package — a human must consciously decide credit
--   semantics for such rows before relaxing the CHECK. There is currently no
--   trial/comp/free 1:1 concept in the codebase (verified: no is_trial/comp/free
--   columns or flows).
--
-- Group/class/instant bookings are NOT affected: they INSERT directly as
-- 'confirmed' with student_package_id pre-set (debited via deduct_package_session
-- before insert) and never call this RPC nor hit pending->confirmed, so neither
-- the deduct trigger's charge branch nor this guard runs for them.
--
-- CREATE OR REPLACE preserves the existing owner (postgres) and the
-- REVOKE/GRANT grants on this function (authenticated, service_role). RLS is
-- untouched. SECURITY semantics unchanged (no SECURITY DEFINER on this fn;
-- the AFTER trigger remains SECURITY DEFINER as in the baseline).

CREATE OR REPLACE FUNCTION "public"."confirm_booking_with_session"(
  "p_booking_id" "uuid",
  "p_room_url" "text",
  "p_room_name" "text",
  "p_expires_at" timestamp with time zone
) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_session_id uuid;
  v_updated_count int;
  v_amount_usd numeric(10,2);
  v_student_package_id uuid;
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

  -- 1b. FAIL-CLOSED money guard. The AFTER UPDATE OF status trigger
  --     `t_deduct_student_package` has now fired and, if it charged a package,
  --     stamped bookings.student_package_id. Re-read the row to see whether a
  --     package was actually charged. A paid 1:1 (amount_usd > 0) that ended up
  --     with NO package charged would be a free session — refuse it. The RAISE
  --     rolls back the status flip (and the trigger's UPDATE), leaving the
  --     booking 'pending'. The orchestrator maps this to BookingConfirmError.
  select amount_usd, student_package_id
    into v_amount_usd, v_student_package_id
  from public.bookings
  where id = p_booking_id;

  if v_amount_usd > 0 and v_student_package_id is null then
    raise exception 'no_package_credit'
      using errcode = 'P0001',
            detail = 'booking ' || p_booking_id ||
                     ' is a paid 1:1 with no package charged — refusing to grant a free session';
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

COMMENT ON FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) IS 'Atomic booking confirmation. UPDATE bookings.status=''confirmed'' + INSERT sessions in one transaction. Raises ''booking_not_pending'' (errcode P0001) when the booking is not currently pending. Raises ''no_package_credit'' (errcode P0001) when a paid 1:1 (amount_usd>0) confirmed with no package charged (deduct_student_package trigger no-op) — fail-closed against free sessions. Called by src/lib/domains/booking/orchestrate.ts confirmBooking(). See ADR-0004.';

-- 20260723000000_finalize_attendance_restore_evidence.sql
--
-- Issue #667 — finalize_attendance keyed restore idempotency off the
-- credit_action='restored' STAMP alone. A row wrongly pre-stamped 'restored'
-- (the buggy 20260714000000 migration could stamp without performing the
-- matching student_packages.sessions_used decrement) satisfied the guard and
-- was skipped forever, so the student's over-counted credit was never
-- repairable by re-running finalize_attendance.
--
-- FIX (issue option 2, self-healing): record per-booking restore EVIDENCE in a
-- new nullable column attendance_records.credit_restored_at, stamped in the
-- same transaction as the actual credit restore. The restore branch now keys
-- off the evidence (credit_restored_at IS NULL), not the credit_action stamp:
-- a row claiming 'restored' without evidence is re-examined and repaired; a
-- row with evidence is never restored twice.
--
-- LEGACY WINDOW (issue option 1, one-shot sweep): verified 2026-07-14 against
-- production — attendance_records is EMPTY (0 rows total, 0 'restored', 0
-- packages with sessions_used > 0), so there are no legacy rows to classify
-- and NO backfill is needed. Deliberately no backfill here: pre-existing
-- stamped rows (test/seed environments only) are treated as unevidenced so a
-- re-finalize repairs them; the clamped restore paths (sessions_used > 0,
-- exact charged package/lot only) bound the effect.
-- Re-verify emptiness at Stripe go-live per the issue's gate.
--
-- Expand/contract: ADD COLUMN (nullable, no default) + CREATE OR REPLACE of
-- an existing function signature. No DROP/RENAME, no type narrowing, no
-- NOT NULL. Old builds ignore the new column; safe under the concurrent
-- migration + Vercel deploy window.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS credit_restored_at timestamptz;

COMMENT ON COLUMN public.attendance_records.credit_restored_at IS
  'Evidence that the session-credit restore for this booking actually ran '
  '(set in the same transaction as the sessions_used decrement / lot restore). '
  'finalize_attendance keys restore idempotency off this, NOT the '
  'credit_action stamp — #667. NULL = never restored (or pre-#667 legacy row).';

-- Function body is 20260719000300''s finalize_attendance verbatim except the
-- restore branch: guard + stamp now use credit_restored_at (marked -- #667).
CREATE OR REPLACE FUNCTION finalize_attendance(
  p_booking_id uuid,
  p_outcome attendance_outcome,
  p_actual_teacher_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_credit_restored_at timestamptz;  -- #667 restore evidence
  v_extension_seconds bigint;
  v_deliverer_id uuid;
  v_rate numeric(10,2);
  v_duration_min integer;
  v_prepaid_window_months int;
  v_restored_lot_id uuid;
  v_restored_pkg_id uuid;  -- #667: subscription-branch decrement evidence
BEGIN
  -- 1. Fetch booking + charged-lot product_type (LEFT JOIN → FOR UPDATE OF b only,
  --    since FOR UPDATE cannot lock the nullable side of an outer join). BUG 3 fix
  --    retained: resolve session via sessions.booking_id reverse link.
  SELECT b.student_id, b.teacher_id,
         COALESCE(
           b.session_id,
           (SELECT s.id FROM sessions s WHERE s.booking_id = b.id ORDER BY s.created_at DESC LIMIT 1)
         ) AS session_id,
         b.subscription_id, b.scheduled_at, b.duration_min,
         b.student_package_id,
         sp.product_type AS charged_product_type
  INTO v_booking
  FROM bookings b
  LEFT JOIN public.student_packages sp ON sp.id = b.student_package_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_attendance: booking % not found', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Idempotent attendance row. credit_action starts 'none' (#662 restore-guard
  --    fix): the restore branch sets 'restored' only AFTER restoring the credit.
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at)
  VALUES (
    p_booking_id, v_booking.student_id, v_booking.teacher_id, v_booking.session_id, p_outcome,
    'none'::credit_action, now()
  )
  ON CONFLICT (booking_id) DO NOTHING;

  -- 3. Restore branch — idempotency keyed off the restore EVIDENCE
  --    (credit_restored_at), NOT the credit_action stamp (#667): a row wrongly
  --    stamped 'restored' without the matching decrement is re-examined and
  --    repaired; a row with evidence is never restored twice.
  SELECT credit_restored_at INTO v_credit_restored_at
    FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_credit_restored_at IS NULL THEN

    IF v_booking.student_package_id IS NOT NULL
       AND v_booking.charged_product_type = 'prepaid_hours' THEN
      -- Prepaid wallet restore (H4): restore the EXACT charged lot, reactivating
      -- it (status='active' + fresh expires_at) if a sweep expired it meanwhile.
      SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
        INTO v_prepaid_window_months
        FROM public.platform_settings WHERE key = 'prepaid_hours_expiry_months';
      v_prepaid_window_months := COALESCE(v_prepaid_window_months, 12);
      IF v_prepaid_window_months <= 0 THEN v_prepaid_window_months := 12; END IF;

      -- Only decrement+reactivate when a used session exists to give back, and
      -- only log/credit when a row actually changed (sessions_used > 0). A lot
      -- that was charged but never decremented (e.g. sessions_used already 0 via
      -- a concurrent path) restores nothing and must not append a bogus
      -- 'restore' event nor mark itself 'restored'.
      WITH restored_lot AS (
        UPDATE public.student_packages
          SET sessions_used = GREATEST(sessions_used - 1, 0),
              status = 'active',
              expires_at = now() + (v_prepaid_window_months * interval '1 month')
          WHERE id = v_booking.student_package_id
            AND product_type = 'prepaid_hours'   -- defense-in-depth: never a sub lot
            AND sessions_used > 0
        RETURNING id
      )
      SELECT id INTO v_restored_lot_id FROM restored_lot;
      IF v_restored_lot_id IS NOT NULL THEN
        PERFORM public.record_prepaid_event(v_restored_lot_id, 'restore', 1, NULL);
      END IF;
    ELSE
      -- Subscription / legacy restore, inlined from restore_student_package(uuid)
      -- (#661) so the decrement reports whether a row actually changed (the
      -- helper returns void and its signature cannot change expand-only — #667
      -- CodeRabbit follow-up): credit the exact charged package
      -- (bookings.student_package_id), clamp via sessions_used > 0, NULL stamp
      -- restores nothing (never re-derive a package — the #363 guard).
      WITH restored_pkg AS (
        UPDATE public.student_packages sp
          SET sessions_used = GREATEST(sp.sessions_used - 1, 0)
          FROM bookings b
          WHERE b.id = p_booking_id
            AND sp.id = b.student_package_id
            AND sp.sessions_used > 0
        RETURNING sp.id
      )
      SELECT id INTO v_restored_pkg_id FROM restored_pkg;
    END IF;

    -- Stamp credit_action='restored' AND the evidence timestamp together, only
    -- when the restore is actually complete: a package/lot row was decremented
    -- (v_restored_pkg_id / v_restored_lot_id), or no package was ever debited
    -- (student_package_id IS NULL — nothing to restore, vacuously complete).
    -- A charged row whose package/lot had sessions_used=0 restores nothing and
    -- must NOT be stamped (else a later re-finalize would skip the work but
    -- still claim it happened — both branches now symmetric, #667). WHERE keys
    -- off the evidence so a wrongly pre-stamped row still gains its evidence
    -- once repaired.
    IF v_booking.student_package_id IS NULL
       OR v_restored_pkg_id IS NOT NULL
       OR v_restored_lot_id IS NOT NULL THEN
      UPDATE attendance_records
        SET credit_action = 'restored', credit_restored_at = now(), finalized_at = now()
        WHERE booking_id = p_booking_id AND credit_restored_at IS NULL;
    END IF;
  END IF;

  -- 4. Excused carry-over → subscription_extensions (idempotent).
  IF p_outcome = 'excused_carried' AND v_booking.subscription_id IS NOT NULL THEN
    v_extension_seconds := COALESCE(v_booking.duration_min, 60) * 60;
    INSERT INTO subscription_extensions (
      subscription_id, booking_id, session_id, granted_by_user_id, reason, extension_seconds
    )
    SELECT
      v_booking.subscription_id, p_booking_id, v_booking.session_id,
      v_booking.student_id, 'excused absence carry-over', v_extension_seconds
    WHERE NOT EXISTS (
      SELECT 1 FROM subscription_extensions
      WHERE subscription_id = v_booking.subscription_id AND booking_id = p_booking_id
    );
  END IF;

  -- 5. Session delivery rows (rate snapshot).
  IF p_outcome IN ('present', 'teacher_absent') AND v_booking.session_id IS NOT NULL THEN
    v_deliverer_id := COALESCE(p_actual_teacher_id, v_booking.teacher_id);
    IF NOT (p_outcome = 'teacher_absent' AND p_actual_teacher_id IS NULL) THEN
      SELECT hourly_rate_usd INTO v_rate FROM profiles WHERE id = v_deliverer_id;
      v_duration_min := COALESCE(v_booking.duration_min, 60);

      INSERT INTO session_deliveries (
        session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month
      )
      SELECT
        v_booking.session_id, v_deliverer_id, v_duration_min,
        COALESCE(v_rate, 0), COALESCE(v_booking.scheduled_at, now()),
        date_trunc('month', COALESCE(v_booking.scheduled_at, now()))::date
      WHERE NOT EXISTS (
        SELECT 1 FROM session_deliveries WHERE session_id = v_booking.session_id
      );
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) TO service_role;

-- 20260719000300_prepaid_wallet_hardening.sql
--
-- Hardens the prepaid-hour wallet money path (spec 038 / spec 039) per a
-- CodeRabbit review of the 038/039 money functions. Every change below closes a
-- concrete correctness/idempotency gap found in review; none alters the
-- wallet's external contract. This is a forward-only hardening migration:
-- CREATE OR REPLACE for each function (same signature → additive), one
-- additive ledger CHECK, and one idempotent backfill.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: every money function keeps SECURITY DEFINER + SET search_path;
--                   EXECUTE is re-locked to service_role only (REVOKE FROM
--                   public/anon/authenticated) so the lockdown persists after
--                   CREATE OR REPLACE. Window reads are clamped against a
--                   non-positive platform_settings value so a corrupt row can
--                   never produce a zero/negative expiry. Idempotency guards
--                   now distinguish "already voided" from "reusable reservation".
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  no student-facing behavior change; restore is now honest
--                  (a no-op restore no longer marks itself 'restored').
--
-- Fixes (one-to-one with the review findings):
--   1. private.guard_prepaid_hours_event_immutable() — the two RAISE EXCEPTION
--      statements had `%` placeholders in the message but NO positional args,
--      so the placeholders rendered literally. Pass old./new. package_id +
--      event_type so the audit string actually interpolates.
--   2. public.grant_prepaid_hours(text, uuid, int, numeric, text) — reject a
--      blank/whitespace payment intent and a non-positive rate at the front
--      guard; clamp a non-positive expiry window to the 12-month default.
--   3. public.deduct_package_session(uuid) — clamp the rolling-reset expiry
--      window to the 12-month default when platform_settings yields <= 0.
--   4. public.finalize_attendance(uuid, attendance_outcome, uuid) — clamp the
--      prepaid restore window; only decrement/reactivate/log/mark-restored when
--      a used session actually exists to give back (CTE ... RETURNING id), so a
--      no-op restore can never append a bogus 'restore' event nor mark itself
--      'restored' (which would later mask the missing restore on re-finalize).
--   5. public.reconcile_external_prepaid_refund(text) — add a status guard so
--      an already-expired lot is not double-voided by a repeated external
--      refund/dispute webhook.
--   6. public.reserve_prepaid_refund(uuid, int, uuid) — a 'released' refund
--      request is NOT reusable (its hours were already restored); raise instead
--      of silently returning its amount, so a retry must take a fresh id.
--   7. public.prepaid_hours_events — additive CHECK enforcing sign consistency
--      per event_type (grant/restore > 0; draw/expired/refunded < 0). The
--      functions above already write correct signs, so no existing row violates
--      it; the constraint is a structural backstop against future regressions.
--   8. Idempotent re-backfill of student_packages.provider_payment_ref from
--      stripe_payment_intent_id for any Stripe lot created between 038 phase 1
--      and the provider-aware grant that still has a NULL ref.
--
-- Expand/contract (AGENTS.md §4): CREATE OR REPLACE (same signatures), one
--   additive CHECK (DROP IF EXISTS only drops a same-named constraint, never a
--   column/table), and a WHERE-guarded UPDATE backfill. No DROP COLUMN/TABLE,
--   no RENAME, no SET NOT NULL, no DROP DEFAULT, no type change. The
--   migration-safety guard has no breaker pattern to flag (DROP CONSTRAINT and
--   ADD CONSTRAINT ... CHECK are not in its matcher), so no expand-contract-ok
--   marker is required. Safe under concurrent migration + Vercel deploy with no
--   ordering gate.
--
-- Statement order: the six function replacements first (plpgsql defers body
--   resolution, so their relative order is unconstrained; logical order kept),
--   then the ledger CHECK (lands after every writer is already correct), then
--   the provider_payment_ref backfill.

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 — private.guard_prepaid_hours_event_immutable(): pass the % args.
-- Source: 20260715000050_prepaid_hour_wallet_schema.sql (~line 190). Body
-- copied verbatim; ONLY the two RAISE EXCEPTION statements changed (positional
-- args added). This trigger fn has no SECURITY DEFINER / SET search_path in the
-- original and none is added; only OWNER is re-asserted (no EXECUTE grants to
-- revoke — it is a trigger fn, never called directly).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function private.guard_prepaid_hours_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'prepaid_hours_events is append-only: DELETE blocked (package_id=%, event_type=%)', old.package_id, old.event_type using errcode = 'P0001', detail = old.event_type::text || ' on ' || old.package_id::text;
  else
    raise exception 'prepaid_hours_events is append-only: UPDATE blocked (package_id=%, event_type=%)', new.package_id, new.event_type using errcode = 'P0001', detail = new.event_type::text || ' on ' || new.package_id::text;
  end if;
end;
$$;

alter function private.guard_prepaid_hours_event_immutable() owner to postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2 — public.grant_prepaid_hours(text, uuid, int, numeric, text):
-- (a) reject blank payment intent + non-positive rate; (b) clamp window <= 0.
-- Source: 20260719000000_grant_prepaid_hours_provider_aware.sql (5-arg body).
-- Copied verbatim; ONLY the first validation IF and the window-clamp line
-- changed. Provider validation, provider_payment_ref idempotency, ON CONFLICT,
-- and stripe_payment_intent_id expand-phase write are all preserved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_prepaid_hours(
  p_payment_intent text,
  p_student uuid,
  p_hours int,
  p_rate numeric,
  p_provider text DEFAULT 'stripe'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id uuid;
  v_window_months int;
BEGIN
  IF p_payment_intent IS NULL OR btrim(p_payment_intent) = '' OR p_student IS NULL OR p_hours IS NULL OR p_hours <= 0 OR p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'grant_prepaid_hours: invalid arguments (intent=%, student=%, hours=%, rate=%)',
      p_payment_intent, p_student, p_hours, p_rate
      USING ERRCODE = 'P0001';
  END IF;

  IF p_provider IS NULL OR p_provider NOT IN ('stripe', 'paypal') THEN
    RAISE EXCEPTION 'grant_prepaid_hours: invalid provider (%)', p_provider
      USING ERRCODE = 'P0001';
  END IF;

  -- H1 idempotency pre-check (fast path): a lot already exists for this payment
  -- reference (Stripe PaymentIntent id or PayPal capture id) → webhook / capture
  -- redelivery. Return the existing id; do NOT append a duplicate grant event.
  SELECT id INTO v_lot_id
    FROM public.student_packages
    WHERE provider_payment_ref = p_payment_intent;
  IF v_lot_id IS NOT NULL THEN
    RETURN v_lot_id;
  END IF;

  -- Rolling expiry window (D5). Missing/blank/0 → default 12 (the seeded value).
  SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
    INTO v_window_months
    FROM public.platform_settings
    WHERE key = 'prepaid_hours_expiry_months';
  v_window_months := COALESCE(v_window_months, 12);
  IF v_window_months <= 0 THEN v_window_months := 12; END IF;

  -- Insert a NEW lot (R1). ON CONFLICT on the cross-provider partial unique
  -- index is the race backstop: two concurrent grants for the same payment ref
  -- cannot both land (the second is a no-op). Partial-index inference requires
  -- the matching WHERE clause. RETURNING captures the id only on a real insert.
  -- Stripe grants keep writing stripe_payment_intent_id (expand-phase back-compat);
  -- PayPal grants leave it NULL and rely on provider_payment_ref.
  INSERT INTO public.student_packages (
    student_id, package_id, sessions_total, sessions_used, status,
    product_type, rate_paid_usd,
    payment_provider, provider_payment_ref, stripe_payment_intent_id,
    expires_at, purchased_at
  )
  VALUES (
    p_student,
    'c0ffee01-0000-4000-8000-000000038000',  -- Phase-1 seeded catalog row
    p_hours,
    0,
    'active',
    'prepaid_hours',
    p_rate,
    p_provider,
    p_payment_intent,
    CASE WHEN p_provider = 'stripe' THEN p_payment_intent ELSE NULL END,
    now() + (v_window_months * interval '1 month'),
    now()
  )
  ON CONFLICT (provider_payment_ref) WHERE provider_payment_ref IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_lot_id;

  -- Lost the race: another grant for the same payment ref landed first. Re-fetch
  -- the existing lot id so the caller gets a stable handle, but DO NOT append a
  -- second grant event (the winner already did).
  IF v_lot_id IS NULL THEN
    SELECT id INTO v_lot_id
      FROM public.student_packages
      WHERE provider_payment_ref = p_payment_intent;
    RETURN v_lot_id;
  END IF;

  -- Real insert: append the singular 'grant' event (R5). The Phase-1 partial
  -- unique index uix_prepaid_hours_events_one_grant_per_lot guarantees exactly
  -- one grant event per lot, even under retry.
  PERFORM public.record_prepaid_event(v_lot_id, 'grant', p_hours, p_payment_intent);

  RETURN v_lot_id;
END;
$$;

ALTER FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3 — public.deduct_package_session(uuid): clamp the rolling-reset window.
-- Source: 20260715000100_prepaid_hour_wallet_functions.sql (~line 164-240).
-- Copied verbatim; ONLY one line added after the window COALESCE (the clamp).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_package_session(p_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_type text;
  v_window_months int;
BEGIN
  -- Canonical debit kernel. Guard predicate identical to the pre-existing SQL
  -- body; the implicit row-level lock satisfies H3. Captures product_type so we
  -- can gate the wallet-specific additions.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + 1
    WHERE id = p_package_id
      AND status = 'active'
      AND sessions_used < sessions_total
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING product_type INTO v_product_type;

  -- No row charged (expired/exhausted/not-found between SELECT and UPDATE).
  -- RETURNING no rows → v_product_type stays NULL → return NULL (matches the
  -- pre-existing SQL fn's "RETURNING true returns no row" semantics).
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- R3 gate: ONLY prepaid_hours lots get the rolling reset + draw event.
  -- Subscription/legacy rows (product_type='subscription' or NULL on legacy
  -- un-backfilled rows) are byte-unchanged: no expires_at mutation, no event.
  IF v_product_type = 'prepaid_hours' THEN
    SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
      INTO v_window_months
      FROM public.platform_settings
      WHERE key = 'prepaid_hours_expiry_months';
    v_window_months := COALESCE(v_window_months, 12);
    IF v_window_months <= 0 THEN v_window_months := 12; END IF;

    -- Rolling expiry reset (D5). Same row, still locked from the debit UPDATE.
    UPDATE public.student_packages
      SET expires_at = now() + (v_window_months * interval '1 month')
      WHERE id = p_package_id;

    PERFORM public.record_prepaid_event(p_package_id, 'draw', -1, NULL);
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION public.deduct_package_session(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.deduct_package_session(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_package_session(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4 — public.finalize_attendance(uuid, attendance_outcome, uuid):
--   (a) clamp the prepaid restore window;
--   (b) only decrement/reactivate/log/mark-restored when a used session exists.
-- Source: 20260716000100_reconcile_finalize_attendance_prepaid.sql (the latest
-- body — already carries the #662 restore-guard fix). Copied verbatim outside
-- the four specified edits: new DECLARE var v_restored_lot_id; window clamp;
-- CTE-with-RETURNING replace of the unconditional UPDATE + PERFORM; gate the
-- attendance_records 'restored' mark so a no-op prepaid restore is NOT marked.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_existing_credit_action credit_action;
  v_extension_seconds bigint;
  v_deliverer_id uuid;
  v_rate numeric(10,2);
  v_duration_min integer;
  v_prepaid_window_months int;
  v_restored_lot_id uuid;
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

  -- 3. Restore branch (idempotent via the guard below).
  SELECT credit_action INTO v_existing_credit_action
    FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN

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
      -- Subscription / legacy restore: restore_student_package(uuid) (added #661)
      -- credits the exact charged package (bookings.student_package_id), clamp >=0,
      -- NULL-stamp no-op. With #662 this branch now actually runs and restores.
      PERFORM restore_student_package(p_booking_id);
    END IF;

    -- Mark credit_action='restored' only when a credit was actually restored.
    -- Subscription branch: restore_student_package already ran → mark. Prepaid
    -- branch: only when a lot row was actually decremented (v_restored_lot_id IS
    -- NOT NULL); a lot with sessions_used=0 restores nothing and must NOT be
    -- marked restored (else a later idempotent re-finalize would skip the work
    -- but still claim it happened).
    IF (v_booking.student_package_id IS NULL
        OR v_booking.charged_product_type <> 'prepaid_hours')
       OR v_restored_lot_id IS NOT NULL THEN
      UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
        WHERE booking_id = p_booking_id AND credit_action <> 'restored';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5 — public.reconcile_external_prepaid_refund(text): status guard so an
-- already-expired lot is not double-voided. Source:
-- 20260719000200_reconcile_external_refund_provider_aware.sql. Copied verbatim
-- outside: new v_status DECLARE; SELECT adds status; idempotency guard now also
-- short-circuits when status <> 'active'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_external_prepaid_refund(p_payment_intent text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_remaining integer;
  v_status text;
BEGIN
  IF p_payment_intent IS NULL THEN
    RAISE EXCEPTION 'reconcile_external_prepaid_refund: p_payment_intent is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Provider-neutral lookup: provider_payment_ref = the Stripe PaymentIntent id
  -- (Stripe lots) or the PayPal capture id (PayPal lots).
  SELECT id, sessions_remaining, status INTO v_id, v_remaining, v_status
    FROM public.student_packages
    WHERE provider_payment_ref = p_payment_intent
      AND product_type = 'prepaid_hours'
    FOR UPDATE;

  -- Not a prepaid lot (subscription / legacy / unknown ref) → nothing to do.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Idempotent: already voided (prior call or the sweep), or already expired
  -- (status <> 'active') — do not double-void / double-log a dormant lot.
  IF v_status <> 'active' OR v_remaining IS NULL OR v_remaining <= 0 THEN
    RETURN;
  END IF;

  -- Void ALL remaining hours on this lot. The wallet balance for this lot drops
  -- to zero; the student cannot spend reversed money.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + v_remaining
    WHERE id = v_id;

  PERFORM public.record_prepaid_event(
    v_id, 'refunded', -v_remaining, p_payment_intent
  );
END;
$$;

ALTER FUNCTION public.reconcile_external_prepaid_refund(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 6 — public.reserve_prepaid_refund(uuid, int, uuid): a 'released' request
-- is not reusable. Source: 20260716000300_prepaid_hours_refund.sql (~line 90-
-- 135). Copied verbatim outside: new v_existing_status DECLARE; the idempotency
-- pre-check SELECT also reads status; inside the existing-amount branch, a
-- 'released' status raises (caller must use a new refund request id).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_prepaid_refund(
  p_lot uuid,
  p_hours int,
  p_refund_request_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_amount numeric(10,2);
  v_existing_status text;
  v_remaining integer;
  v_rate numeric(10,2);
  v_pi text;
  v_amount numeric(10,2);
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: p_hours must be > 0 (got %)', p_hours
      USING ERRCODE = 'P0001';
  END IF;
  IF p_refund_request_id IS NULL THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: p_refund_request_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize same-id concurrent calls (idempotency race backstop).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_refund_request_id::text, 0));

  -- Idempotent pre-check: a pending/succeeded request with this id already
  -- exists → return its amount without re-voiding. A 'released' request is NOT
  -- reusable (its hours were already restored on Stripe failure) → raise so the
  -- caller uses a fresh refund request id instead of silently re-returning the
  -- old amount while no hours get re-voided.
  SELECT amount_usd, status INTO v_existing_amount, v_existing_status
    FROM public.prepaid_refund_requests
    WHERE id = p_refund_request_id;
  IF v_existing_amount IS NOT NULL THEN
    IF v_existing_status = 'released' THEN
      RAISE EXCEPTION 'reserve_prepaid_refund: request % was already released; use a new refund request id',
        p_refund_request_id USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_amount;
  END IF;

  -- Lock + validate the lot. product_type gate is the money-correctness rail:
  -- only prepaid_hours lots have a frozen rate_paid_usd and a stripe_payment_intent_id.
  SELECT sessions_remaining, rate_paid_usd, stripe_payment_intent_id
    INTO v_remaining, v_rate, v_pi
    FROM public.student_packages
    WHERE id = p_lot
      AND product_type = 'prepaid_hours'
      AND status = 'active'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: lot % is not an active prepaid_hours lot', p_lot
      USING ERRCODE = 'P0001';
  END IF;

  -- Block over-refund (defense-in-depth; the lot lock already serialized
  -- same-lot refunds so v_remaining is the post-lock truth).
  IF p_hours > v_remaining THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: over-refund — requesting % hours, lot % has % remaining',
      p_hours, p_lot, v_remaining
      USING ERRCODE = 'P0001';
  END IF;

  -- Frozen rate sanity. Subscription/legacy rows have NULL rate but are already
  -- excluded by the product_type gate; this guards a corrupt lot row.
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: lot % has no frozen rate_paid_usd', p_lot
      USING ERRCODE = 'P0001';
  END IF;

  v_amount := p_hours * v_rate;

  -- VOID the hours now (R8): immediately unspendable. Kept hours stay active.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + p_hours
    WHERE id = p_lot;

  -- Insert the saga row. PK (id) UNIQUE is the structural idempotency backstop
  -- in case the advisory lock was somehow bypassed.
  INSERT INTO public.prepaid_refund_requests (
    id, package_id, hours, amount_usd, stripe_payment_intent_id, status
  )
  VALUES (
    p_refund_request_id, p_lot, p_hours, v_amount, v_pi, 'pending'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN v_amount;
END;
$$;

ALTER FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 7 — ledger sign-consistency CHECK on public.prepaid_hours_events.
-- Structural backstop: grant/restore must carry hours_delta > 0; draw/expired/
-- refunded must carry hours_delta < 0. The functions above already write
-- correct signs, so no existing row violates this and ADD CONSTRAINT succeeds
-- cleanly. DROP IF EXISTS only removes a same-named constraint (never a column
-- or table) — not a migration-safety breaker.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.prepaid_hours_events DROP CONSTRAINT IF EXISTS prepaid_hours_events_sign_check;
ALTER TABLE public.prepaid_hours_events ADD CONSTRAINT prepaid_hours_events_sign_check CHECK (
  (event_type IN ('grant','restore') AND hours_delta > 0) OR
  (event_type IN ('draw','expired','refunded') AND hours_delta < 0)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 8 — idempotent re-backfill of provider_payment_ref. Covers any Stripe
-- prepaid lot created between 20260718000000 (which added the column) and
-- 20260719000000 (the provider-aware grant that started populating it) that
-- still has a NULL ref. WHERE-guarded so it is safe to re-run (only fills
-- missing refs; never overwrites). uix_student_packages_stripe_payment_intent
-- already enforces one lot per intent, so backfilling provider_payment_ref
-- from it cannot create a dup against uix_student_packages_provider_payment_ref.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.student_packages SET provider_payment_ref = stripe_payment_intent_id
  WHERE payment_provider = 'stripe'
    AND stripe_payment_intent_id IS NOT NULL
    AND provider_payment_ref IS NULL;

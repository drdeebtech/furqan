-- 20260814000000_single_session_refund.sql
-- Spec: docs/superpowers/specs/2026-07-19-single-session-refund-design.md
-- Admin-initiated + Stripe-dashboard-fallback refund for cash-paid single sessions
-- (assessment/specialized/instant; bookings.student_package_id IS NULL).
-- Cancel-at-finalize saga mirroring 20260716000300 (prepaid). Purely ADDITIVE
-- (1 table, 5 SECURITY DEFINER fns, RLS in-migration) → expand/contract-safe.

-- 1. Saga ledger (admin path only; the dashboard fallback writes no row).
CREATE TABLE IF NOT EXISTS public.single_session_refund_requests (
  id                     uuid primary key,          -- = Stripe idempotencyKey + metadata.refund_request_id
  booking_id             uuid not null references public.bookings(id) on delete restrict,
  stripe_payment_intent  text not null,             -- frozen from payments at reserve (audit)
  stripe_refund_id       text,                      -- set at finalize (re_...)
  amount_usd             numeric(10,2) not null check (amount_usd > 0),  -- audit only; NOT sent to Stripe
  status                 text not null default 'pending'
                           check (status in ('pending','succeeded','released')),
  created_at             timestamptz not null default now(),
  resolved_at            timestamptz
);

-- Double-refund backstop: at most one live request per booking.
CREATE UNIQUE INDEX IF NOT EXISTS single_session_refund_one_live
  ON public.single_session_refund_requests (booking_id) WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS idx_ssrr_pi
  ON public.single_session_refund_requests (stripe_payment_intent);

ALTER TABLE public.single_session_refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ssrr_select_own ON public.single_session_refund_requests;
CREATE POLICY ssrr_select_own ON public.single_session_refund_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = single_session_refund_requests.booking_id
              AND b.student_id = (select auth.uid()))
    OR private.is_admin()
  );
-- No write policy → only service_role (via the SECURITY DEFINER fns below) writes.

-- 2. Shared cancel step. Cancels iff still pending/confirmed; never throws
--    (a throw in the webhook path wedges it with money already refunded).
--    Returns jsonb { did_cancel, booking_id, student_id, teacher_id } for the
--    TS webhook to emit booking.cancelled.
CREATE OR REPLACE FUNCTION public._cancel_single_session_for_refund(p_booking uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status booking_status; v_student uuid; v_teacher uuid;
BEGIN
  SELECT status, student_id, teacher_id INTO v_status, v_student, v_teacher
  FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('did_cancel', false, 'booking_id', p_booking);
  END IF;
  IF v_status IN ('pending','confirmed') THEN
    UPDATE bookings SET status = 'cancelled' WHERE id = p_booking;
    RETURN jsonb_build_object('did_cancel', true, 'booking_id', p_booking,
                              'student_id', v_student, 'teacher_id', v_teacher);
  END IF;
  -- In-flight window: already delivered/settled. Reconcile, don't throw.
  RAISE WARNING 'single-session refund: booking % not cancellable (status=%) — money refunded, reconcile', p_booking, v_status;
  RETURN jsonb_build_object('did_cancel', false, 'booking_id', p_booking, 'status', v_status);
END; $$;

-- 3. reserve — admin path. Opens a pending saga row; does NOT cancel yet.
CREATE OR REPLACE FUNCTION public.reserve_single_session_refund(
  p_booking uuid, p_refund_request_id uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing numeric(10,2); v_status booking_status; v_pkg uuid;
        v_pi text; v_amount numeric(10,2); v_provider text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_refund_request_id::text));
  SELECT amount_usd INTO v_existing FROM single_session_refund_requests WHERE id = p_refund_request_id;
  IF FOUND THEN RETURN v_existing; END IF;                      -- idempotent on request id

  SELECT status, student_package_id INTO v_status, v_pkg FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % not found', p_booking USING errcode='P0002';
  END IF;
  IF v_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % not refundable (status=%)', p_booking, v_status USING errcode='P0001';
  END IF;
  -- Single-session predicate (CodeRabbit): this saga refunds ONLY cash single
  -- sessions. A package-funded booking must never be refunded/cancelled here.
  IF v_pkg IS NOT NULL THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % is package-funded — not a single session', p_booking USING errcode='P0001';
  END IF;

  SELECT stripe_payment_intent, amount_usd, provider INTO v_pi, v_amount, v_provider
  FROM payments WHERE booking_id = p_booking ORDER BY created_at DESC LIMIT 1;
  IF v_pi IS NULL OR v_provider IS DISTINCT FROM 'stripe' THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % has no Stripe payment (provider=%) — refund via that provider', p_booking, coalesce(v_provider,'none') USING errcode='P0001';
  END IF;

  -- Clean "already pending" error before the unique-index violation surfaces a
  -- raw duplicate-key to the admin UI (the partial unique index is the backstop).
  IF EXISTS (SELECT 1 FROM single_session_refund_requests
             WHERE booking_id = p_booking AND status <> 'released') THEN
    RAISE EXCEPTION 'reserve_single_session_refund: refund already pending for booking %', p_booking USING errcode='P0001';
  END IF;

  INSERT INTO single_session_refund_requests (id, booking_id, stripe_payment_intent, amount_usd, status)
  VALUES (p_refund_request_id, p_booking, v_pi, v_amount, 'pending');
  RETURN v_amount;
END; $$;

-- 4. finalize — webhook path (charge.refunded, refund_kind='single_session').
--    Returns jsonb { did_cancel, booking_id, student_id, teacher_id }.
CREATE OR REPLACE FUNCTION public.finalize_single_session_refund(
  p_refund_request_id uuid, p_stripe_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_booking uuid; v_result jsonb;
BEGIN
  SELECT status, booking_id INTO v_status, v_booking
  FROM single_session_refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_single_session_refund: no request %', p_refund_request_id USING errcode='P0002';
  END IF;
  IF v_status = 'succeeded' THEN
    RETURN jsonb_build_object('did_cancel', false, 'already', true);   -- redelivery
  END IF;
  IF v_status = 'released' THEN
    RAISE EXCEPTION 'finalize_single_session_refund: request % already released — success webhook inconsistent', p_refund_request_id USING errcode='P0001';
  END IF;

  v_result := public._cancel_single_session_for_refund(v_booking);
  UPDATE single_session_refund_requests
    SET status='succeeded', stripe_refund_id=p_stripe_ref, resolved_at=now()
    WHERE id = p_refund_request_id;
  RETURN v_result;
END; $$;

-- 5. release — admin path, Stripe failure. Booking untouched (never cancelled at reserve).
CREATE OR REPLACE FUNCTION public.release_single_session_refund(p_refund_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM single_session_refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_single_session_refund: no request %', p_refund_request_id USING errcode='P0002';
  END IF;
  IF v_status = 'succeeded' THEN
    RAISE EXCEPTION 'release_single_session_refund: request % already succeeded', p_refund_request_id USING errcode='P0001';
  END IF;
  IF v_status = 'released' THEN RETURN; END IF;                 -- idempotent
  UPDATE single_session_refund_requests SET status='released', resolved_at=now() WHERE id=p_refund_request_id;
END; $$;

-- 6. reconcile — Stripe-dashboard fallback (charge.refunded, NO refund_request_id).
--    Disjoint from prepaid/subscription by construction: matches ONLY a
--    single-session (student_package_id IS NULL) stripe-provider booking.
CREATE OR REPLACE FUNCTION public.reconcile_external_single_session_refund(p_payment_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking uuid;
BEGIN
  SELECT b.id INTO v_booking
  FROM payments p JOIN bookings b ON b.id = p.booking_id
  WHERE p.stripe_payment_intent = p_payment_intent
    AND p.provider = 'stripe'
    AND b.student_package_id IS NULL
  ORDER BY p.created_at DESC LIMIT 1;
  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('did_cancel', false, 'matched', false);
  END IF;
  RETURN public._cancel_single_session_for_refund(v_booking);
END; $$;

-- 7. EXECUTE lockdown (NFR-002) — service_role only for all five + the shared step.
DO $lock$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public._cancel_single_session_for_refund(uuid)',
    'public.reserve_single_session_refund(uuid, uuid)',
    'public.finalize_single_session_refund(uuid, text)',
    'public.release_single_session_refund(uuid)',
    'public.reconcile_external_single_session_refund(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $lock$;

-- walk-single-session-refund.sql — proves the single-session refund saga money path.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-single-session-refund.sql
-- BEGIN..ROLLBACK — leaves the DB untouched. Needs >=4 seeded students.
BEGIN;

-- Block 1 — admin path: reserve, double-refund block, finalize, redelivery.
DO $$
DECLARE
  v_student uuid; v_teacher uuid; v_booking uuid; v_pay uuid;
  v_req1 uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid();
  v_amt numeric; v_res jsonb; v_blocked boolean := false;
BEGIN
  SELECT id INTO v_student FROM profiles WHERE role='student' LIMIT 1;
  SELECT id INTO v_teacher FROM profiles WHERE role='teacher' LIMIT 1;
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type,
                        session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_student, v_teacher, NULL, 'assessment', 'hifz', 30, 0, 0, 0, 0, 'confirmed')
    RETURNING id INTO v_booking;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_booking, v_student, 'pi_walk_1', 'stripe', 20.00, 20.00, 0.00)
    RETURNING id INTO v_pay;

  v_amt := reserve_single_session_refund(v_booking, v_req1);
  ASSERT v_amt = 20.00, 'reserve amount';
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req1) = 'pending', 'reserve pending';

  BEGIN
    PERFORM reserve_single_session_refund(v_booking, v_req2);
  EXCEPTION WHEN OTHERS THEN v_blocked := true;   -- clean "already pending" error OR unique_violation
  END;
  ASSERT v_blocked, 'double-refund blocked (already-pending guard / unique index)';

  v_res := finalize_single_session_refund(v_req1, 're_walk_1');
  ASSERT (v_res->>'did_cancel') = 'true', 'finalize cancelled';
  ASSERT (v_res->>'student_id') = v_student::text, 'finalize returns student';
  ASSERT (SELECT status FROM bookings WHERE id=v_booking) = 'cancelled', 'booking cancelled';
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req1) = 'succeeded', 'request succeeded';

  v_res := finalize_single_session_refund(v_req1, 're_walk_1');
  ASSERT (v_res->>'already') = 'true', 'finalize redelivery idempotent';

  RAISE NOTICE 'ADMIN PATH OK';
END $$;

-- Block 2 — release, PayPal reject, package-funded reject, external reconcile.
-- Distinct student per booking to avoid the per-student active-assessment uniqueness.
DO $$
DECLARE
  v_students uuid[]; v_t uuid; v_b uuid; v_req uuid := gen_random_uuid();
  v_res jsonb; v_err boolean := false; v_pkg uuid;
BEGIN
  SELECT array_agg(id) INTO v_students FROM (SELECT id FROM profiles WHERE role='student' LIMIT 4) s;
  SELECT id INTO v_t FROM profiles WHERE role='teacher' LIMIT 1;

  -- release: reserve then release → released, booking untouched
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_students[1], v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_students[1], 'pi_walk_2', 'stripe', 15,15,0);
  PERFORM reserve_single_session_refund(v_b, v_req);
  PERFORM release_single_session_refund(v_req);
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req)='released', 'released';
  ASSERT (SELECT status FROM bookings WHERE id=v_b)='confirmed', 'booking untouched after release';

  -- paypal reject
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_students[2], v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, paypal_order_id, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_students[2], NULL, 'paypal', 'po_1', 15,15,0);
  BEGIN PERFORM reserve_single_session_refund(v_b, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_err := true; END;
  ASSERT v_err, 'paypal booking rejected at reserve';

  -- package-funded reject (single-session-only predicate). Uses v_students[4]
  -- (unused above) + any existing package id — the guard only checks NOT NULL.
  SELECT id INTO v_pkg FROM student_packages LIMIT 1;
  IF v_pkg IS NOT NULL THEN
    INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
      VALUES (v_students[4], v_t, v_pkg, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
    INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
      VALUES (v_b, v_students[4], 'pi_walk_4', 'stripe', 15,15,0);
    v_err := false;
    BEGIN PERFORM reserve_single_session_refund(v_b, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_err := true; END;
    ASSERT v_err, 'package-funded booking rejected at reserve';
  END IF;

  -- external reconcile: dashboard refund cancels the booking; 2nd call noop; unknown PI no-op
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_students[3], v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_students[3], 'pi_walk_3', 'stripe', 15,15,0);
  v_res := reconcile_external_single_session_refund('pi_walk_3');
  ASSERT (v_res->>'did_cancel')='true' AND (SELECT status FROM bookings WHERE id=v_b)='cancelled', 'external reconcile cancels';
  v_res := reconcile_external_single_session_refund('pi_walk_3');
  ASSERT (v_res->>'did_cancel')='false', 'external reconcile idempotent';
  v_res := reconcile_external_single_session_refund('pi_does_not_exist');
  ASSERT (v_res->>'matched')='false', 'external reconcile no-op for unknown PI';

  RAISE NOTICE 'RELEASE / PAYPAL / PACKAGE / EXTERNAL OK';
END $$;
ROLLBACK;

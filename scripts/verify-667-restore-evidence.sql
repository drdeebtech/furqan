-- Rolled-back verification walk for issue #667 — finalize_attendance must
-- repair a row wrongly stamped credit_action='restored' whose
-- student_packages.sessions_used decrement never happened (the poison the
-- buggy 20260714000000 migration could leave), and must never restore twice.
--
-- Run against LOCAL Supabase only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f scripts/verify-667-restore-evidence.sql
--
-- Everything runs in one transaction and rolls back — no residue.
BEGIN;

DO $walk$
DECLARE
  v_student uuid;
  v_teacher uuid;
  v_pkg     uuid;
  v_booking uuid;
  v_used    int;
BEGIN
  -- Self-seed two identities inside the transaction (rolled back with the
  -- rest of the walk); profiles.id FK-references auth.users.
  v_student := gen_random_uuid();
  v_teacher := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES
    (v_student, v_student || '@walk667.furqan.test'),
    (v_teacher, v_teacher || '@walk667.furqan.test');
  INSERT INTO public.profiles (id) VALUES (v_student), (v_teacher);

  -- Subscription-style package: 3 of 8 sessions used before the incident.
  INSERT INTO student_packages (student_id, sessions_total, sessions_used)
  VALUES (v_student, 8, 3)
  RETURNING id INTO v_pkg;

  INSERT INTO bookings (student_id, teacher_id, duration_min, rate_snapshot, amount_usd, student_package_id)
  VALUES (v_student, v_teacher, 60, 10, 10, v_pkg)
  RETURNING id INTO v_booking;

  -- POISONED STATE (the #667 gap): the attendance row is already stamped
  -- 'restored', but sessions_used was never decremented for it.
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, outcome, credit_action, finalized_at)
  VALUES (v_booking, v_student, v_teacher, 'teacher_absent', 'restored', now());

  -- INV-1: re-running finalize_attendance repairs the missed restore.
  PERFORM finalize_attendance(v_booking, 'teacher_absent'::attendance_outcome, NULL::uuid);
  SELECT sessions_used INTO v_used FROM student_packages WHERE id = v_pkg;
  IF v_used <> 2 THEN
    RAISE EXCEPTION 'INV-1 FAIL: poisoned ''restored'' row was not repaired (sessions_used=%, want 2)', v_used;
  END IF;
  RAISE NOTICE 'INV-1 PASS: missed restore repaired (3 -> 2)';

  -- INV-2: a second re-run must NOT restore again (evidence now stamped).
  PERFORM finalize_attendance(v_booking, 'teacher_absent'::attendance_outcome, NULL::uuid);
  SELECT sessions_used INTO v_used FROM student_packages WHERE id = v_pkg;
  IF v_used <> 2 THEN
    RAISE EXCEPTION 'INV-2 FAIL: repaired row was restored twice (sessions_used=%, want 2)', v_used;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM attendance_records
    WHERE booking_id = v_booking AND credit_action = 'restored' AND credit_restored_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'INV-2 FAIL: repaired row missing stamp+evidence';
  END IF;
  RAISE NOTICE 'INV-2 PASS: no double restore on re-run; stamp + evidence present';

  -- INV-3: the normal path (never finalized before) restores exactly once.
  INSERT INTO bookings (student_id, teacher_id, duration_min, rate_snapshot, amount_usd, student_package_id)
  VALUES (v_student, v_teacher, 60, 10, 10, v_pkg)
  RETURNING id INTO v_booking;

  PERFORM finalize_attendance(v_booking, 'teacher_absent'::attendance_outcome, NULL::uuid);
  PERFORM finalize_attendance(v_booking, 'teacher_absent'::attendance_outcome, NULL::uuid);
  SELECT sessions_used INTO v_used FROM student_packages WHERE id = v_pkg;
  IF v_used <> 1 THEN
    RAISE EXCEPTION 'INV-3 FAIL: normal path restored % times, want exactly 1 (sessions_used=%, want 1)', 2 - v_used, v_used;
  END IF;
  RAISE NOTICE 'INV-3 PASS: normal path restores exactly once (2 -> 1, idempotent re-run)';
END
$walk$;

ROLLBACK;

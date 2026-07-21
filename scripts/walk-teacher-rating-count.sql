-- walk-teacher-rating-count.sql
-- Rolled-back local walk for 20260815000000_teacher_rating_count_materialized.
-- Proves, against the real local DB:
--   W1  update_teacher_rating maintains rating_count (ALL reviews, including
--       is_public=false — owner policy 2026-07-19) alongside rating_avg.
--   W2  search_public_teachers returns the teacher with the materialized count.
--   W3  every visibility gate still excludes the teacher: is_archived,
--       NOT is_accepting, cv_status<>'approved', is_test_account, avatar NULL.
--
-- Seeding uses session_replication_role=replica (superuser, LOCAL ONLY) to
-- skip the bookings FK chain — the reviews reference booking ids that never
-- exist. The trigger is then exercised with triggers re-enabled by DELETING a
-- sacrificial review: a child-row DELETE never re-checks the parent FK, while
-- an UPDATE of a same-transaction row would (RI re-check on self-inserted
-- rows is what failed the first draft of this walk).
-- Run: psql <local-url> -v ON_ERROR_STOP=1 -f scripts/walk-teacher-rating-count.sql

BEGIN;

SET session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('99999999-0000-4000-8000-000000000101', 'walk-rc-teacher@walk.test'),
  ('99999999-0000-4000-8000-000000000102', 'walk-rc-student@walk.test');

INSERT INTO public.profiles (id, role, roles, is_test_account, full_name, avatar_url) VALUES
  ('99999999-0000-4000-8000-000000000101', 'teacher', ARRAY['teacher']::user_role[], false,
   'Walk Rating Teacher', 'https://example.com/walk-teacher.png'),
  ('99999999-0000-4000-8000-000000000102', 'student', ARRAY['student']::user_role[], false,
   'Walk Student', NULL);

INSERT INTO public.teacher_profiles
  (teacher_id, bio, bio_en, languages, specialties, hourly_rate, gender,
   total_sessions, is_archived, is_accepting, cv_status)
VALUES
  ('99999999-0000-4000-8000-000000000101', 'معلم اختبار', 'walk test teacher',
   ARRAY['ar'], ARRAY['hifz'], 20, 'male', 10, false, true, 'approved');

-- 2 public + 2 private reviews; the rating=1 private one is sacrificial (its
-- DELETE below fires the trigger with triggers live). booking ids fabricated
-- (FK skipped in replica mode).
INSERT INTO public.reviews (booking_id, student_id, teacher_id, rating, is_public) VALUES
  ('99999999-0000-4000-8000-00000000b001', '99999999-0000-4000-8000-000000000102',
   '99999999-0000-4000-8000-000000000101', 5, true),
  ('99999999-0000-4000-8000-00000000b002', '99999999-0000-4000-8000-000000000102',
   '99999999-0000-4000-8000-000000000101', 4, true),
  ('99999999-0000-4000-8000-00000000b003', '99999999-0000-4000-8000-000000000102',
   '99999999-0000-4000-8000-000000000101', 3, false),
  ('99999999-0000-4000-8000-00000000b004', '99999999-0000-4000-8000-000000000102',
   '99999999-0000-4000-8000-000000000101', 1, false);

SET session_replication_role = DEFAULT;

-- Fire the trigger with triggers live: DELETE the sacrificial review.
-- Remaining: ratings 5 (public), 4 (public), 3 (private) → count 3, avg 4.00.
DELETE FROM public.reviews
WHERE booking_id = '99999999-0000-4000-8000-00000000b004';

-- W1: materialized aggregates count ALL remaining reviews (incl. the private one).
DO $$
DECLARE v_count int; v_avg numeric;
BEGIN
  SELECT rating_count, rating_avg INTO v_count, v_avg
  FROM public.teacher_profiles
  WHERE teacher_id = '99999999-0000-4000-8000-000000000101';
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'W1 FAIL: rating_count=% (expected 3 — all reviews incl. private)', v_count;
  END IF;
  IF v_avg IS DISTINCT FROM 4.00 THEN
    RAISE EXCEPTION 'W1 FAIL: rating_avg=% (expected 4.00)', v_avg;
  END IF;
  RAISE NOTICE 'W1 OK: rating_count=3 (private counted), rating_avg=4.00';
END $$;

-- W2: search returns the teacher with the materialized count.
DO $$
DECLARE v_count int;
BEGIN
  SELECT s.rating_count INTO v_count
  FROM public.search_public_teachers() s
  WHERE s.id = '99999999-0000-4000-8000-000000000101';
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'W2 FAIL: search rating_count=% (expected 3)', v_count;
  END IF;
  RAISE NOTICE 'W2 OK: search returns materialized rating_count=3';
END $$;

-- W3: each gate independently removes the teacher from search results.
DO $$
DECLARE
  t uuid := '99999999-0000-4000-8000-000000000101';
  n int;
BEGIN
  -- archived
  UPDATE public.teacher_profiles SET is_archived = true WHERE teacher_id = t;
  SELECT count(*) INTO n FROM public.search_public_teachers() s WHERE s.id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'W3 FAIL: archived teacher visible'; END IF;
  UPDATE public.teacher_profiles SET is_archived = false WHERE teacher_id = t;

  -- not accepting
  UPDATE public.teacher_profiles SET is_accepting = false WHERE teacher_id = t;
  SELECT count(*) INTO n FROM public.search_public_teachers() s WHERE s.id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'W3 FAIL: not-accepting teacher visible'; END IF;
  UPDATE public.teacher_profiles SET is_accepting = true WHERE teacher_id = t;

  -- cv not approved
  UPDATE public.teacher_profiles SET cv_status = 'pending_review' WHERE teacher_id = t;
  SELECT count(*) INTO n FROM public.search_public_teachers() s WHERE s.id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'W3 FAIL: unapproved-cv teacher visible'; END IF;
  UPDATE public.teacher_profiles SET cv_status = 'approved' WHERE teacher_id = t;

  -- test account
  UPDATE public.profiles SET is_test_account = true WHERE id = t;
  SELECT count(*) INTO n FROM public.search_public_teachers() s WHERE s.id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'W3 FAIL: test-account teacher visible'; END IF;
  UPDATE public.profiles SET is_test_account = false WHERE id = t;

  -- no photo
  UPDATE public.profiles SET avatar_url = NULL WHERE id = t;
  SELECT count(*) INTO n FROM public.search_public_teachers() s WHERE s.id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'W3 FAIL: photo-less teacher visible'; END IF;
  UPDATE public.profiles SET avatar_url = 'https://example.com/walk-teacher.png' WHERE id = t;

  RAISE NOTICE 'W3 OK: all 5 visibility gates exclude correctly';
END $$;

ROLLBACK;

-- T002b: Backfill class_offerings.current_enrollment from session_participants.
--
-- CodeRabbit CR4 finding: 20260617990000_class_offerings_extend.sql added
-- current_enrollment with DEFAULT 0 but never backfilled it for existing
-- rows. joinHalaqa / open_overflow_halaqa / increment_enrollment all key
-- capacity checks off this column, so legacy offerings with enrolled
-- participants would report current_enrollment=0 and allow over-capacity
-- enrollments on the very next join.
--
-- This migration is idempotent: the WHERE clause skips rows whose count
-- is already correct, so re-runs (e.g. on a reset-then-replay) are cheap
-- and safe.

UPDATE class_offerings co
SET current_enrollment = sub.registered_count
FROM (
  SELECT session_id, COUNT(*)::int AS registered_count
  FROM session_participants
  WHERE attendance_status = 'registered'
  GROUP BY session_id
) sub
WHERE co.session_id = sub.session_id
  AND co.current_enrollment <> sub.registered_count;

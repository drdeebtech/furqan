-- ============================================================================
-- V14.4: Performance Indexes
--
-- Backs three hot query paths identified by a perf audit:
--
-- 1. sessions.booking_id lookup  — every student/teacher dashboard runs
--    `.select(...).in("booking_id", bookingIds)` against `sessions` when
--    computing live-session state and recent-session history. No index
--    existed on the FK column alone, forcing a seq scan + filter.
--
-- 2. sessions live-detection composite — the live-session query filters
--    on booking_id AND started_at IS NOT NULL AND ended_at IS NULL.
--    A single composite covers all three predicates; partial WHERE
--    makes it small (only live rows qualify).
--
-- 3. homework_assignments.student_id — student-dashboard homework roll-up
--    hits `.eq("student_id", uid)` without the status predicate (summary
--    count). The existing (student_id, status) index can serve this but
--    a dedicated index has lower leaf overhead at query time.
--
-- All CREATE INDEX IF NOT EXISTS — safe to reapply.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sessions_booking_id
  ON sessions(booking_id);

CREATE INDEX IF NOT EXISTS idx_sessions_live
  ON sessions(booking_id)
  WHERE started_at IS NOT NULL AND ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_homework_student_all
  ON homework_assignments(student_id, created_at DESC);

INSERT INTO schema_migrations (version, description)
VALUES ('14.4.0', 'V14.4: Perf indexes — sessions(booking_id), sessions live partial, homework(student_id, created_at)')
ON CONFLICT DO NOTHING;

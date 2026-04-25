-- ============================================================================
-- V14.7: Admin surface performance indexes
--
-- Backs hot filter+sort columns on admin pages identified by ADMIN_AUDIT.md.
-- Schema-verified against the linked Supabase project on 2026-04-25:
--   * bookings has no booking_date column — uses scheduled_at.
--   * sessions has no status/start_time — state is derived from
--     started_at/ended_at. v14_004 already covers the live-session predicate
--     via idx_sessions_live, so this migration only adds an index on
--     started_at DESC for the admin "recent sessions" ordering.
--   * notifications uses is_read boolean, not a read_at timestamp.
--
-- All CREATE INDEX IF NOT EXISTS — safe to reapply. Adds < 30 MB.
-- ============================================================================

-- 1. /admin/bookings filters by status and orders by scheduled_at.
--    Dashboard counts pending bookings and lists today's by scheduled_at.
CREATE INDEX IF NOT EXISTS idx_bookings_status_scheduled
  ON bookings(status, scheduled_at DESC);

-- 2. /admin/sessions list orders by started_at DESC. Most recent first.
--    Live-session detection is already served by v14_004 idx_sessions_live.
CREATE INDEX IF NOT EXISTS idx_sessions_started_at
  ON sessions(started_at DESC);

-- 3. Control-tower's pending-CV count queries this exact subset.
--    Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_teacher_cv_pending
  ON teacher_profiles(created_at DESC)
  WHERE cv_status = 'pending_review';

-- 4. /admin/retention orders by churn_risk_score DESC and joins to student.
CREATE INDEX IF NOT EXISTS idx_retention_signals_risk
  ON retention_signals(churn_risk_score DESC, student_id);

-- 5. Notification bell + per-user notification page filter unread = false
--    and order by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);

-- 6. /admin/audit pages by descending creation time.
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at DESC);

INSERT INTO schema_migrations (version, description)
VALUES ('14.7.0', 'V14.7: Admin perf indexes — bookings(status,scheduled_at), sessions(started_at), teacher CV partial, retention(risk,student), notifications(user,is_read,created_at), audit_log(created_at)')
ON CONFLICT DO NOTHING;

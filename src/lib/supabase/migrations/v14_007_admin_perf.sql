-- ============================================================================
-- V14.7: Admin surface performance indexes
--
-- Backs hot filter+sort columns on admin pages identified by ADMIN_AUDIT.md:
--
-- 1. bookings(status, booking_date) — admin/bookings filters by status and
--    orders by date; admin/dashboard counts pending bookings and lists today's.
--
-- 2. sessions(status, start_time) — admin/sessions filters by status and orders
--    by start_time; control-tower's "stuck sessions" alert filters on status.
--
-- 3. teacher_profiles partial on cv_status='pending_review' — control-tower's
--    pending-CV count queries this exact subset; partial index keeps it small.
--
-- 4. retention_signals(churn_risk_score DESC, student_id) — admin/retention's
--    primary list orders by churn_risk_score DESC and joins to student.
--
-- 5. notifications(user_id, read_at, created_at DESC) — admin notification bell
--    + per-user notification page hit this combo; covers unread filter.
--
-- 6. audit_log(created_at DESC) — admin/audit pages by descending time.
--
-- All CREATE INDEX IF NOT EXISTS — safe to reapply. Adds ~10–30 MB at most.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_status_date
  ON bookings(status, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_status_start
  ON sessions(status, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_cv_pending
  ON teacher_profiles(created_at DESC)
  WHERE cv_status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_retention_signals_risk
  ON retention_signals(churn_risk_score DESC, student_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at DESC);

INSERT INTO schema_migrations (version, description)
VALUES ('14.7.0', 'V14.7: Admin perf indexes — bookings(status,date), sessions(status,start), teacher CV partial, retention(risk,student), notifications(user,unread,created), audit_log(created)')
ON CONFLICT DO NOTHING;

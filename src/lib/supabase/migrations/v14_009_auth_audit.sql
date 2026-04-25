-- ============================================================================
-- V14.9: Extend audit_log to capture auth events (LOGIN / LOGOUT)
--
-- The audit_log table already has every column needed to record auth events:
-- changed_by (user id), table_name, record_id, action, new_data (jsonb for
-- email/role/user_agent), ip_address, created_at. Only the action CHECK
-- constraint needs to expand from {INSERT,UPDATE,DELETE} to also allow
-- {LOGIN,LOGOUT}.
--
-- Adding a partial index keeps per-user timeline queries fast even as
-- auth-event rows grow (most rows are mutations, partial index stays small).
--
-- Retention policy: a separate daily cron at /api/cron/audit-cleanup deletes
-- LOGIN/LOGOUT rows older than 90 days (matches privacy policy commitment).
-- Mutation rows (INSERT/UPDATE/DELETE) are EXEMPT and retained for compliance
-- (financial records require 7-year retention per privacy policy).
-- ============================================================================

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'));

-- Partial index: only auth events. Per-user timeline + admin filter both hit
-- this index path. Stays small because mutations (the majority of rows) are
-- excluded.
CREATE INDEX IF NOT EXISTS idx_audit_log_auth_events
  ON audit_log(changed_by, created_at DESC)
  WHERE action IN ('LOGIN', 'LOGOUT');

INSERT INTO schema_migrations (version, description)
VALUES ('14.9.0', 'V14.9: audit_log allows LOGIN/LOGOUT actions + partial index for auth events')
ON CONFLICT DO NOTHING;

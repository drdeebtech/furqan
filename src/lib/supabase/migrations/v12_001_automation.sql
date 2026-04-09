-- ============================================================================
-- V12: Automation Infrastructure
-- automation_logs table for n8n workflow tracking + feature flags
-- ============================================================================

-- ─── 1. automation_logs table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name    text        NOT NULL,
  event_name       text,
  entity_type      text,
  entity_id        uuid,
  idempotency_key  text        UNIQUE,
  status           text        NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','failed','skipped')),
  channel          text,
  payload_json     jsonb,
  result_json      jsonb,
  error_message    text,
  attempt_count    integer     NOT NULL DEFAULT 1,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  trace_id         uuid        NOT NULL DEFAULT gen_random_uuid()
);

-- ─── 2. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_automation_logs_workflow
  ON automation_logs(workflow_name, status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_entity
  ON automation_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_started
  ON automation_logs(started_at DESC);

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

-- Admin/mod can read logs
CREATE POLICY "admin_mod_read_automation_logs" ON automation_logs
  FOR SELECT USING (is_admin_or_mod());

-- Service role (n8n) handles all writes — no user-facing INSERT/UPDATE policies needed

-- ─── 4. Feature flags for automation families ───────────────────────────────

INSERT INTO platform_settings (key, value, description) VALUES
  ('automation_enabled', 'true', 'Master switch for all n8n automations'),
  ('whatsapp_enabled', 'true', 'Enable WhatsApp delivery channel'),
  ('ai_parent_reports_enabled', 'false', 'Enable AI-generated parent reports'),
  ('teacher_quality_monitor_enabled', 'false', 'Enable teacher quality scoring'),
  ('retention_automation_enabled', 'false', 'Enable student risk detection and re-engagement'),
  ('renewal_campaigns_enabled', 'false', 'Enable package renewal reminders')
ON CONFLICT (key) DO NOTHING;

-- ─── 5. Migration record ────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES ('12.1.0', 'V12: Automation infrastructure — automation_logs table + feature flags')
ON CONFLICT DO NOTHING;

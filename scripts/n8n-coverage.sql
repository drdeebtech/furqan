-- n8n workflow coverage queries — copy-paste runnable in Supabase Studio.
-- Run after hardening (T019) and after the first 24h of new workflows firing.

-- @block: Last log per workflow
-- Lists every TARGETS workflow and when it last fired.
-- Rows with last_log IS NULL or last_log older than expected interval = gap.
WITH expected (workflow_name, max_interval) AS (
  VALUES
    ('retention-scorer',              INTERVAL '25 hours'),
    ('bunny-stuck-lessons',           INTERVAL '25 hours'),
    ('cron-audit-cleanup',            INTERVAL '25 hours'),
    ('cron-email-health',             INTERVAL '25 hours'),
    ('cron-reconciliation',           INTERVAL '25 hours'),
    ('session-reminder-engine',       INTERVAL '15 minutes'),
    ('role-based-welcome',            INTERVAL '25 hours'),
    ('cv-approval-notification',      INTERVAL '25 hours'),
    ('teacher-onboarding-nudges',     INTERVAL '25 hours'),
    ('learning-streak-encouragement', INTERVAL '25 hours'),
    ('no-show-detector',              INTERVAL '10 minutes'),
    ('first-student-celebration',     INTERVAL '25 hours'),
    ('missed-session-parent-alert',   INTERVAL '25 hours'),
    ('dailyco-room-creation',         INTERVAL '25 hours'),
    ('abandoned-booking-recovery',    INTERVAL '25 hours'),
    ('package-renewal-campaign',      INTERVAL '25 hours'),
    ('auto-decline-stale-bookings',   INTERVAL '25 hours'),
    ('package-expiry-countdown',      INTERVAL '25 hours'),
    ('homework-noncompletion-parent-alert', INTERVAL '25 hours'),
    ('low-package-balance-alert',     INTERVAL '25 hours'),
    ('workflow-failure-sentinel',     INTERVAL '25 hours'),
    ('milestone-celebrations',        INTERVAL '25 hours'),
    ('trial-to-paid-conversion',      INTERVAL '25 hours'),
    ('upsell-higher-package',         INTERVAL '25 hours'),
    ('inactivity-reengagement',       INTERVAL '25 hours'),
    ('parent-post-session-report',    INTERVAL '25 hours'),
    ('realtime-kpi-alerting',         INTERVAL '25 hours'),
    ('student-at-risk-detector',      INTERVAL '25 hours'),
    ('teacher-eval-compliance',       INTERVAL '25 hours'),
    ('teacher-quality-monitor',       INTERVAL '25 hours'),
    ('weekly-progress-digest',        INTERVAL '25 hours'),
    ('session-auto-complete',         INTERVAL '16 minutes'),
    ('audit-log-enrichment',          INTERVAL '25 hours'),
    ('announcement-broadcaster',      INTERVAL '25 hours'),
    ('message-content-moderation',    INTERVAL '25 hours'),
    -- New cron-route workflows (wired via spec 009):
    ('cron-auto-complete-sessions',   INTERVAL '16 minutes'),
    ('cron-cache-clear',              INTERVAL '25 hours'),
    ('cron-handoff-cleanup',          INTERVAL '25 hours'),
    ('cron-murajaah-due',             INTERVAL '25 hours'),
    ('cron-n8n-healthcheck',          INTERVAL '16 minutes')
)
SELECT
  e.workflow_name,
  MAX(a.started_at)                                            AS last_log,
  e.max_interval                                              AS expected_interval,
  CASE
    WHEN MAX(a.started_at) IS NULL                            THEN 'NEVER LOGGED'
    WHEN MAX(a.started_at) < NOW() - e.max_interval           THEN 'OVERDUE'
    ELSE 'OK'
  END                                                         AS coverage_status
FROM expected e
LEFT JOIN automation_logs a USING (workflow_name)
GROUP BY e.workflow_name, e.max_interval
ORDER BY coverage_status DESC, e.workflow_name;

-- @block: Dead-letter view — terminal failures awaiting operator attention
-- Rows: status='failed' AND attempt_count >= the max_retries encoded in result_json.
-- Use this to find workflows that have exhausted retries and need manual intervention.
SELECT
  id,
  workflow_name,
  event_name,
  error_message,
  attempt_count,
  result_json ->> 'max_retries'                              AS max_retries,
  payload_json,
  started_at,
  finished_at
FROM automation_logs
WHERE status = 'failed'
  AND attempt_count >= COALESCE((result_json ->> 'max_retries')::int, 3)
ORDER BY finished_at DESC
LIMIT 50;

-- Sentry admin-flow fixes (2026-06-21)
-- Resolves a cluster of production 22P02 / PGRST204 errors raised by the
-- admin control-tower and settings flows. See Sentry FURQAN-3J, -3K, -3H,
-- -3S, -3R, -3Q, -3P.

-- 1. audit_log.record_id — allow NULL.
--    The loudAction/routeAction audit path writes record_id for every audited
--    action. Bulk control-tower actions touch many rows (no single id) and
--    key-based platform_settings updates have no UUID row id at all. Writing a
--    non-UUID sentinel ("bulk") or a text setting key into a uuid column raised
--    `invalid input syntax for type uuid` (22P02) on every such action. NULL is
--    the correct representation for "not a single-row change"; the human-
--    readable target is preserved in audit_log.reason. The existing
--    (table_name, record_id) index tolerates NULLs.
ALTER TABLE public.audit_log ALTER COLUMN record_id DROP NOT NULL;

-- 2. automation_logs.retry_at + 'pending_retry' status.
--    Control-tower "retry failed automations" marks the last 24h of failed
--    rows as pending_retry with a retry_at timestamp for the n8n retry
--    workflow. The column never existed (PGRST204: "Could not find the
--    'retry_at' column") and 'pending_retry' was not in the status CHECK, so
--    the action failed twice over. Add the column and extend the allowed set.
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS retry_at timestamptz;

ALTER TABLE public.automation_logs DROP CONSTRAINT IF EXISTS automation_logs_status_check;
ALTER TABLE public.automation_logs ADD CONSTRAINT automation_logs_status_check
  CHECK (status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text, 'pending_retry'::text]));

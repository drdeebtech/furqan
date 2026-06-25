-- Phase 1.2: Dead-Letter Nurse — add retry coordination fields
-- Codex design: source_execution_id enables n8n's /executions/{id}/retry endpoint.
-- claimed_at prevents double-retry when nurse runs concurrent (atomic PATCH guard).
-- next_retry_at drives the backoff query (no polling-loop needed in n8n).
-- escalated_at ensures Telegram alert fires exactly once per failure chain.

ALTER TABLE automation_dead_letter
  ADD COLUMN IF NOT EXISTS source_execution_id text,
  ADD COLUMN IF NOT EXISTS workflow_id          text,
  ADD COLUMN IF NOT EXISTS last_execution_id    text,
  ADD COLUMN IF NOT EXISTS next_retry_at        timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at         timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at           timestamptz;

-- Index for the nurse's due-row query
CREATE INDEX IF NOT EXISTS idx_adl_due
  ON automation_dead_letter (next_retry_at)
  WHERE resolved_at IS NULL AND escalated_at IS NULL;

-- Index for the escalation sweep
CREATE INDEX IF NOT EXISTS idx_adl_escalate
  ON automation_dead_letter (attempt_count)
  WHERE resolved_at IS NULL AND escalated_at IS NULL;

COMMENT ON COLUMN automation_dead_letter.source_execution_id IS
  'n8n execution ID of the original failed run — used for POST /executions/{id}/retry';
COMMENT ON COLUMN automation_dead_letter.workflow_id IS
  'n8n workflow ID, sourced from the Error Trigger payload';
COMMENT ON COLUMN automation_dead_letter.last_execution_id IS
  'n8n execution ID returned by the most recent retry attempt';
COMMENT ON COLUMN automation_dead_letter.next_retry_at IS
  'Earliest time the Nurse should attempt the next retry. Formula: last_failed_at + min(6h, 15min * 2^(attempt_count-1))';
COMMENT ON COLUMN automation_dead_letter.escalated_at IS
  'Timestamp of the Telegram escalation alert. NULL = not yet escalated. Set atomically to prevent duplicate alerts.';
COMMENT ON COLUMN automation_dead_letter.claimed_at IS
  'Set by the Nurse at the start of a retry attempt, cleared on completion. Prevents double-retry within a single nurse interval.';

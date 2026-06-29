-- spec 025 / issue #491: make automation_logs idempotency retry-safe platform-wide.
--
-- Problem: the plain UNIQUE(idempotency_key) constraint makes a status='failed'
-- row TERMINAL. Once an attempt fails, its row holds the only unique slot for
-- that key, so a retry with the same key can never insert — a transient n8n
-- outage permanently drops the message. This silently contradicts every
-- consumer's retry-safe guarantee (specs 018/021/022/023).
--
-- Fix: replace the constraint with a partial UNIQUE index that EXCLUDES failed
-- rows. Failed attempts no longer hold the slot (and remain as an audit trail of
-- past failures), while non-failed rows (started/succeeded/skipped) keep
-- exactly-once semantics. `status` is NOT NULL with a CHECK in
-- (started,succeeded,failed,skipped), so `status <> 'failed'` is never NULL and
-- the predicate excludes precisely the failed rows.
--
-- Consumer audit (confirmed no reliance on terminal-failed behaviour):
--   • automation/emit.ts        — plain insert of failed/skipped; a duplicate
--                                  failed key now inserts cleanly instead of
--                                  erroring. Strictly better.
--   • reports/send-narrative.ts — guard scoped to status='succeeded'; unaffected.
--   • actions/retention-nudge   — inserts succeeded rows, still deduped by key.
--   • domains/certificates/issue — used .maybeSingle() on the key, which assumed
--                                  ≤1 row per key. Updated in the same change to
--                                  ignore failed rows (.neq status 'failed') and
--                                  the spec-023 T030 delete-and-retry workaround
--                                  is retired.

ALTER TABLE public.automation_logs
  DROP CONSTRAINT IF EXISTS automation_logs_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS automation_logs_idempotency_key_active_uniq
  ON public.automation_logs (idempotency_key)
  WHERE status <> 'failed';

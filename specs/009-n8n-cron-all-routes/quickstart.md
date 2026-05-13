# Quickstart — n8n Re-establish & Harden Rollout

> **Purpose**: hands-on runbook for the operator executing this spec. Follows the canonical 50k-DAU-safe rollout order: harden first (no behavior change), then wire (new behavior), then audit (lock in truth).

## Prerequisites

- SSH access to Mac mini (host: `n8n.drdeeb.tech`).
- n8n REST API personal access token in `~/.zshenv` or local `.env`: `N8N_API_KEY=<token>`.
- Supabase service-role key for `automation_logs` writes (already in n8n credential vault as `Supabase FURQAN`).
- Repo cloned + branch `009-n8n-cron-all-routes` checked out.

## Phase A — Harden existing workflows (one-shot, idempotent)

**Time**: ~5 minutes. **Risk**: low — script is purely additive and idempotent.

```bash
# 1. Dry-run to preview every workflow's diff
node scripts/n8n-harden/run.mjs --dry-run

# 2. Inspect the output; ensure each workflow shows either:
#    - "would add Log Run + onError" (good)
#    - "skip — already hardened" (good)

# 3. Apply
node scripts/n8n-harden/run.mjs
```

**Verify**: after the next schedule interval for each workflow, run:
```sql
SELECT workflow_name, MAX(started_at) AS last_fire
FROM automation_logs
WHERE workflow_name IN (
  SELECT slug FROM (VALUES
    ('retention-scorer'), ('session-reminder-engine'),
    ('dailyco-room-creation'), ('no-show-detector')
    -- ... full list from TARGETS
  ) AS t(slug)
)
GROUP BY workflow_name
ORDER BY last_fire DESC NULLS LAST;
```
Every workflow should have a `last_fire` within its expected cadence.

## Phase B — Add `withCronMonitor` wrappers to 2 bare routes

**Files**: `src/app/api/cron/cache-clear/route.ts`, `src/app/api/cron/n8n-healthcheck/route.ts`

```typescript
// cache-clear/route.ts — wrap the existing handler
export const GET = withCronMonitor("cron-cache-clear", "0 4 * * *", async (request: Request) => {
  // ... existing body ...
});

// n8n-healthcheck/route.ts — same shape
export const GET = withCronMonitor("cron-n8n-healthcheck", "*/15 * * * *", async (request: Request) => {
  // ... existing body ...
});
```

**Verify**:
```bash
npm run build  # type-check passes
git diff src/app/api/cron/cache-clear/route.ts src/app/api/cron/n8n-healthcheck/route.ts
```

## Phase C — Create 5 new n8n workflows (one per missing cron route)

For each of: `auto-complete-sessions`, `cache-clear`, `handoff-cleanup`, `murajaah-due`, `n8n-healthcheck`:

1. In n8n UI: New Workflow → name it `furqan-cron-<route-name>`.
2. Build it per `contracts/n8n-workflow-shape.md`:
   - Schedule Trigger with the cron expression from the route's `withCronMonitor()` arg #2.
   - HTTP node calling `https://www.furqan.today/api/cron/<route-name>` with both auth headers.
   - `Log Run` HTTP node hanging in parallel off the trigger (NOT after `Call Route`).
3. Save (this stores the workflowId).
4. Add `(workflowId, slug)` to `scripts/n8n-harden/run.mjs` TARGETS.
5. Run `node scripts/n8n-harden/run.mjs <workflowId> <slug>` to re-bind credentials by ID.
6. Activate the workflow.
7. Manually fire once via n8n UI "Execute Workflow"; check `automation_logs` for the new row.

## Phase D — Backfill `AUTOMATION_REGISTRY.md`

For every entry in TARGETS that doesn't have a complete registry row, add one. Use this template:

```markdown
### WF-NN furqan-<slug>
- **owner**: <ops|product>
- **trigger**: cron `<expr>` → GET `/api/cron/<name>`  (or webhook path / manual)
- **input**: <event name + payload shape>
- **output**: <side-effect description>
- **idempotency**: `<key>`
- **retry**: <N attempts, <backoff>>
- **alert_on**: <condition>
- **kpi**: <metric>
- **flag**: <flag_name | none>
```

For every existing registry row NOT in TARGETS, either:
- Add `**status**: stubbed` line, OR
- Move the row to a new `## Phase-N Backlog` subsection at the bottom.

## Phase E — Build the audit script

```bash
# scripts/n8n-audit.mjs — new file
# Reuses scripts/n8n-harden/lib.mjs REST helpers
# Output: Markdown with 3 H2 sections

node scripts/n8n-audit.mjs > /tmp/n8n-audit.md
cat /tmp/n8n-audit.md
```

**Validate**:
- `registered+live` count matches the size of TARGETS.
- `registered+missing` ≤ 5 (per SC-005).
- `live+unregistered` = 0 (per SC-006).

## Phase F — Smoke-test the full pipeline

```sql
-- Within 24h of Phase C completion, every cron route should appear:
SELECT
  workflow_name,
  COUNT(*) FILTER (WHERE status = 'succeeded') AS ok,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  MAX(started_at) AS last_fire
FROM automation_logs
WHERE started_at > NOW() - INTERVAL '24 hours'
  AND workflow_name LIKE 'cron-%'
GROUP BY workflow_name
ORDER BY workflow_name;
```

Expect **10 rows**, one per cron route. `ok` should be > 0; `failed` should be 0.

## Rollback

If something goes wrong at any phase:

- **Phase A (hardening)**: hardening is purely additive; remove the `Log Run` node in n8n UI per workflow. No data loss.
- **Phase B (wrappers)**: `git checkout src/app/api/cron/{cache-clear,n8n-healthcheck}/route.ts && npm run build`.
- **Phase C (new workflows)**: in n8n UI, disable (don't delete — keeps `automation_logs` history valid).
- **Phase D (registry edits)**: `git checkout AUTOMATION_REGISTRY.md`.
- **Phase E (audit script)**: `git rm scripts/n8n-audit.mjs`.

## Definition of Done

- [ ] `node scripts/n8n-audit.mjs` shows `live+unregistered: 0`.
- [ ] 10/10 cron routes have a row in `automation_logs` from the past 24h (Phase F query).
- [ ] All TARGETS workflows show a `Log Run` row in `automation_logs` from the past schedule interval (Phase A verify query).
- [ ] `AUTOMATION_REGISTRY.md` has no stub rows intermixed with live rows (Phase D `git diff`).
- [ ] PR review confirms no secrets committed to repo (`git log --all --pretty=format:'%h %s' | xargs -I{} git show {} -- '*.json'` returns nothing under `n8n*`).
- [ ] Constitution check re-run from `plan.md` still passes (no new violations).

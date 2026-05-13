# n8n Workflow Hardening Runbook

**Standard (effective 2026-05-03):** every active furqan-* n8n workflow MUST log a row to Supabase `automation_logs` on every trigger fire, regardless of downstream success or failure.

This standard exists because we discovered `furqan-daily-admin-digest` had been broken for 14+ days without anyone noticing — it never logged, so nothing surfaced the failure. The "Log Run" node added by the hardening script fires in parallel with the rest of the chain, guaranteeing presence-detection.

## How the hardening works

For every workflow, the script `scripts/n8n-harden/run.mjs` does three things:

1. **Adds `onError: "continueRegularOutput"` and `alwaysOutputData: true` on every HTTP node**, so a single fetch failure doesn't break the chain or leave downstream nodes silent on empty input.
2. **Re-binds known credentials by ID** on every HTTP and Telegram node. The n8n REST PUT clears credentials when the body doesn't supply them, so the script reads the credential map (Supabase FURQAN, Daily.co API, Telegram bot, webhook secret, Resend) and reattaches each.
3. **Adds a "Log Run" node hanging off the trigger in parallel** with the existing chain. It POSTs `{workflow_name, event_name: "trigger.fired", status: "succeeded", started_at, finished_at}` to `automation_logs`. Always succeeds when the trigger fires; can't observe downstream failures (that's the sentinel's job).

The hardening is idempotent — re-running skips workflows that already have a `Log Run` node.

## Adding a new workflow

When you create a new workflow in n8n:

1. Add its `(workflowId, slug)` pair to the `TARGETS` array in `scripts/n8n-harden/run.mjs`.
2. Run `node scripts/n8n-harden/run.mjs <workflowId> <slug>` to harden the single workflow without touching others.
3. Wait for the next schedule fire and verify a row appears in `automation_logs` with `workflow_name='<slug>'`.

## Rotating a credential

The hardening script binds credentials by ID. If you rotate a credential (regenerate the value in n8n), the workflow keeps working — same credential ID, new value behind it. No re-hardening needed.

If you create a NEW credential and want workflows to use it, update the `CRED` constant in `scripts/n8n-harden/lib.mjs` and re-run `run.mjs`.

## Verifying a workflow is logging

```sql
select status, started_at, error_message
from automation_logs
where workflow_name = '<slug>'
order by started_at desc
limit 5;
```

Expect at least one row per fire interval (every-5-min workflow → 12 rows/hour, daily → 1 row/day).

To find workflows that have stopped logging:

```sql
with expected as (
  select unnest(array[
    'platform-health-check',
    'session-reminder-engine',
    'retention-scorer',
    -- … add the rest
  ]) as workflow_name
)
select e.workflow_name, max(a.started_at) as last_log
from expected e
left join automation_logs a using (workflow_name)
group by e.workflow_name
having max(a.started_at) < now() - interval '24 hours' or max(a.started_at) is null;
```

## Why credentials get bound by ID instead of by name

n8n stores credential references in workflow JSON as `{ "supabaseApi": { "id": "vvmTgkS5u8riX0I0", "name": "Supabase FURQAN" } }`. The `id` is what binds; the `name` is just a label. Looking up credential IDs once via `GET /api/v1/credentials` and hardcoding them in `lib.mjs` lets the script restore bindings without operator UI clicks. The trade-off: if a credential is recreated (different ID), `lib.mjs` needs updating.

## Why MCP can't do this

The `mcp__claude_ai_n8n__update_workflow` MCP tool regenerates node UUIDs on every save and doesn't expose the credential block. That breaks credential bindings that n8n stores against node UUIDs. The REST API direct-PUT approach in this runbook preserves both, which is why the hardening script bypasses MCP.

For schema validation during workflow design, MCP's `validate_workflow` is still useful — but the actual save MUST go through the REST API.

## Failure sentinel

`furqan-workflow-failure-sentinel` is the safety net. If a workflow's `Log Run` node fails for any reason (Supabase outage, credential drift, etc.) the sentinel still catches the failed n8n execution via the n8n REST `/executions?status=error` endpoint and writes a row.

The sentinel was previously broken (always returned `status='skipped'`) — that's a separate fix tracked in the project memory.

## Verifying coverage

Use `scripts/n8n-coverage.sql` (two `-- @block` sections, copy-paste into Supabase Studio):

**Block 1 — last log per workflow**: shows every TARGETS slug, when it last fired, and whether it's within its expected cadence. Cadence reference:

| Workflow | Expected interval |
|----------|------------------|
| `cron-auto-complete-sessions`, `no-show-detector`, `session-auto-complete`, `session-reminder-engine`, `cron-n8n-healthcheck` | 16 min |
| All other daily cron routes | 25 h |

**Block 2 — dead-letter view**: surfaces rows where `status='failed' AND attempt_count >= max_retries`. These are terminal failures that exhausted retries and need operator intervention.

After the first hardening run, some workflows may show `NEVER LOGGED` in Block 1 — that's expected until they fire at least once. After 24 h, every TARGETS workflow should show `OK` or `OVERDUE` (the latter means a missed fire that needs investigation).

## Audit script

`scripts/n8n-audit.mjs` diffs live n8n workflows against `AUTOMATION_REGISTRY.md` and outputs Markdown with four sections:

| Section | What it shows |
|---------|---------------|
| `## Registered + Live` | Healthy: in registry AND active in n8n, with last-fire timestamp |
| `## Registered + Missing` | Risk: in registry but NOT active in n8n — stale doc or deactivated workflow |
| `## Live + Unregistered` | Risk: active in n8n but NOT in registry — orphaned workflow, nobody owns it |
| `## Naming Violations` | Any live workflow not matching `furqan-[a-z0-9]+(-[a-z0-9]+)*` |

**Run it:**
```bash
node scripts/n8n-audit.mjs > /tmp/n8n-audit.md
cat /tmp/n8n-audit.md
```

**Target state** (per SC-005, SC-006):
- `Registered + Missing` ≤ 5
- `Live + Unregistered` = 0
- `Naming Violations` = 0

**CI integration (recommended):** run weekly in GitHub Actions and pipe to Telegram admin channel when `Live + Unregistered > 0`:

```yaml
# .github/workflows/n8n-audit.yml
on:
  schedule:
    - cron: '0 8 * * 1'  # 08:00 UTC every Monday
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/n8n-audit.mjs > /tmp/audit.md
        env:
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - name: Alert if unregistered workflows found
        run: |
          COUNT=$(grep -c "^- " /tmp/audit.md | tail -1 || echo 0)
          # post to Telegram if Live+Unregistered > 0 ...
```

## Files

- `scripts/n8n-harden/lib.mjs` — REST API helpers, credential map, hardening transform.
- `scripts/n8n-harden/run.mjs` — Driver that takes the workflow list and applies the transform.
- `scripts/n8n-coverage.sql` — Coverage + dead-letter SQL (copy-paste into Supabase Studio).
- `scripts/n8n-audit.mjs` — Registry-vs-live diff script outputting Markdown.
- `docs/n8n-hardening-runbook.md` — This file.

# Phase 1 Data Model — n8n Re-establish & Harden

> This spec **does not modify the database schema** (per Clarification Q4 + Q6). All entities below describe data already deployed.

## E-001: `automation_logs` (existing table, authoritative)

**Source of truth**: `supabase/migrations/20260428*_role_check_*.sql` references this table; schema as currently deployed in production.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | PK |
| `workflow_name` | text | Stable slug, e.g. `cron-cache-clear` |
| `event_name` | text | `trigger.fired`, `booking.confirmed`, etc. |
| `entity_type` | text \| null | Optional — what the workflow operated on |
| `entity_id` | uuid \| null | Foreign key into the relevant entity table |
| `idempotency_key` | text | Per-fire dedupe key, e.g. `reminder:{booking_id}:{window}` |
| `status` | text | `started` \| `succeeded` \| `failed` \| `skipped` |
| `channel` | text \| null | Delivery channel if applicable (`email`, `telegram`, etc.) |
| `payload_json` | jsonb | Full inbound payload for replay/debug |
| `result_json` | jsonb | Workflow-specific output; **per Q4: new per-workflow fields go here, not as new columns** |
| `error_message` | text \| null | Last error on `status='failed'` |
| `attempt_count` | int | Retry counter |
| `started_at` | timestamptz | Trigger fire time |
| `finished_at` | timestamptz \| null | Run completion time |
| `trace_id` | uuid | For cross-workflow correlation |

**Invariants**:
- One `status='started'` row per fire, one terminal row (`succeeded`/`failed`/`skipped`) per fire.
- `attempt_count` monotonically increases per `idempotency_key`.
- `result_json` is JSONB and can hold workflow-specific fields without column-level migrations.

## E-002: `automation_logs` "dead-letter view" (logical, not a real view)

Per Clarification Q6 + FR-014, the dead-letter "view" is the query:

```sql
SELECT *
FROM automation_logs
WHERE status = 'failed'
  AND attempt_count >= (result_json->>'max_retries')::int
ORDER BY finished_at DESC;
```

The sentinel (`furqan-workflow-failure-sentinel`) runs this query. No real Postgres VIEW object is required — the spec explicitly avoids schema changes. Operators may create a VIEW for convenience later in a separate migration if useful.

**Invariants**:
- A row appearing in this view AND tagged as critical (per R-005) triggers a Telegram admin alert.

## E-003: `AUTOMATION_REGISTRY.md` row (Markdown table row)

Not a database entity — a Markdown row in the repo. Source of truth for human-readable workflow ownership.

| Column | Required | Description |
|--------|----------|-------------|
| `id` | yes | Stable `WF-NN` token; never reused |
| `name` | yes | `furqan-<area>-<verb>` kebab-case slug |
| `owner` | yes | Human role responsible for correctness + on-call (`ops`, `product`, etc.) |
| `trigger` | yes | `webhook /path`, `cron <expr>`, or `manual` |
| `input` | yes | Event name + payload shape |
| `output` | yes | Side-effects (notify, DB write, 3rd-party call) |
| `idempotency` | yes | Key used to dedupe (matches `automation_logs.idempotency_key`) |
| `retry` | yes | Attempts + backoff + dead-letter target |
| `alert_on` | yes | Conditions that page admin (Telegram) |
| `kpi` | yes | How we measure this workflow is working |
| `flag` | yes (may be `none`) | Feature flag gate; explicit `none` if ungated |

**New optional column** (added by this spec): `status: stubbed` for rows where the n8n workflow doesn't exist yet. Rows in TARGETS MUST NOT carry `status: stubbed`.

**Partitioning**: rows are organized by Area heading (1–12 per BLUEPRINT). Stubs not yet built belong in a new `## Phase-N Backlog` subsection at the bottom.

## E-004: n8n Workflow JSON (n8n-side, not in repo)

| Element | Required | Description |
|---------|----------|-------------|
| Trigger node | yes | Schedule Trigger (cron) or Webhook node |
| `Log Run` HTTP node | yes (post-hardening) | Hangs off the trigger; POSTs to Supabase `automation_logs` with `workflow_name + event_name=trigger.fired + status=succeeded + timestamps` |
| HTTP-to-app node | yes (for cron-firing workflows) | `Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` headers |
| `onError: continueRegularOutput` | yes (all HTTP nodes) | Failure must not break the chain |
| `alwaysOutputData: true` | yes (all HTTP nodes) | Downstream nodes always have data |
| Credential references | yes | Bound by ID via `CRED` constant in `scripts/n8n-harden/lib.mjs` |

**Stable identity**: `(workflowId, slug)` pair in `scripts/n8n-harden/run.mjs` TARGETS. Workflow IDs are assigned by n8n on creation; slugs are operator-chosen and locked at first hardening.

## E-005: Audit script output (transient, stdout)

Schema for `scripts/n8n-audit.mjs` Markdown output:

```markdown
# n8n Workflow Audit — <ISO timestamp>

## Registered + Live (count: N)

- `<slug>` — `WF-NN` — owner: `<role>` — last fire: `<timestamp>` (or `no logs`)

## Registered + Missing (count: N)

- `<slug>` — `WF-NN` — owner: `<role>` — registered but no n8n workflow found

## Live + Unregistered (count: N)

- `<slug>` — n8n ID: `<workflowId>` — present in n8n but missing from AUTOMATION_REGISTRY.md
```

**Invariants**:
- Sections sorted alphabetically by slug within each.
- Counts in headers match bullet counts.
- Deterministic byte-for-byte output for the same n8n state (per FR-002).

## State Transitions

This feature doesn't introduce new state machines. The only relevant lifecycle is `automation_logs.status`:

```
[NEW]
  ↓ (workflow fires)
[started]
  ↓ (work completes)
[succeeded] | [failed] | [skipped]
  ↓ (if [failed] AND attempt_count < max_retries)
[started]  (next retry)
  ↓ (final retry exhausted)
[failed]  (terminal — appears in dead-letter view)
```

This lifecycle is already implemented by the n8n workflows + `Log Run` node. This spec does not change it; it only enforces that every active workflow participates in it.

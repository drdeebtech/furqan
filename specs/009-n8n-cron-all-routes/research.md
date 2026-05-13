# Phase 0 Research — n8n Re-establish & Harden

## R-001: Cron expression for `cache-clear`

**Decision**: `0 4 * * *` (04:00 UTC daily)

**Rationale**:
- Aligned with the other cleanup crons: `audit-cleanup` at 02:00 UTC, `reconciliation` at 03:00 UTC. Sequential ordering avoids contention on shared tables (`audit_log`, `daily_webhook_events`).
- 04:00 UTC = 07:00 Kuwait local = lowest live-session traffic (admin digest fires at 07:00 UTC after this finishes).
- Daily is sufficient: cache-clear's job is to bust stale ISR/CDN entries; sub-daily churn does not move the needle on stale-content perception at 50k DAU.

**Alternatives considered**:
- `*/30 * * * *` — too aggressive; would trigger 48× the n8n fires/day for marginal user-visible benefit.
- `0 */6 * * *` — 4× daily; rejected because nothing else in the cleanup band runs at 10/16/22 UTC and the unique-fire-time pattern is operationally cheaper to debug.

## R-002: Cron expression for `n8n-healthcheck`

**Decision**: `*/15 * * * *` (every 15 minutes)

**Rationale**:
- n8n-healthcheck is the circuit-breaker for the rest of the automation layer. If it fires every 15 min, an n8n outage is detected within 15 min — fast enough for the operator to react before the daily-digest gap surfaces it a day late.
- 96 fires/day at 50k DAU = ~0.0011 fires/student/day — economically negligible vs. the operational value.
- 5-minute polling (288 fires/day) is 3× the cost for ~10 min latency reduction; not justified.

**Alternatives considered**:
- Daily (`0 6 * * *`) — too slow; an n8n outage starting at 00:01 stays invisible until 06:00.
- Every-5-min — preferred initial reaction but the marginal value over 15-min is small; pick 15-min as the cost-balanced default and re-evaluate after a month of data.

## R-003: New table vs. existing `automation_logs` for dead-letter

**Decision**: No new table. Reuse `automation_logs` with the filter `status='failed' AND attempt_count >= max_retries`.

**Rationale** (per Clarification Q6):
- `automation_logs` already has `payload_json`, `error_message`, `attempt_count`, `status` — every field a dead-letter row would need.
- Single-table design simplifies the sentinel query: one SQL view (`automation_logs_dead_letter`) suffices.
- Migration-free per CLAUDE.md migration policy: column-level changes require a separate migration + ADR.

**Alternatives considered**:
- New `automation_dead_letter` table per BLUEPRINT.md §7 recommendation — rejected; the recommendation predates the current `automation_logs` schema, which already absorbs the role.
- Soft-delete dead rows after N days — deferred; current 30-day window is acceptable at current volume.

## R-004: Audit script auth + output format

**Decision**: Reuse `scripts/n8n-harden/lib.mjs` (which holds the n8n personal access token via env `N8N_API_KEY`) and emit Markdown with three H2 sections.

**Rationale** (per Clarification Q2):
- The hardening script already plumbs n8n REST creds; doubling it in the audit script is duplication.
- Markdown output renders inline in PR descriptions and operator chat. JSON would require a separate render step.
- Deterministic ordering (alphabetical by slug) makes the output diffable across runs — operators can grep for "did anything change today".

**Alternatives considered**:
- JSON output piped through `jq` — rejected; adds a step to every operator interaction.
- HTML report — over-engineered for a script that runs ad-hoc and is read by operators in a terminal/PR.

## R-005: Critical-tag definition

**Decision**: Critical = `furqan-workflow-failure-sentinel` watch-list ∪ the 5 newly-wired cron routes (per Clarification Q3).

**Rationale**:
- Avoids adding a `critical: bool` column to `AUTOMATION_REGISTRY.md` (column drift risk).
- Anchors the definition to deployed behavior (the sentinel) rather than table metadata.
- 5 newly-wired routes are critical by default because their downstream effects (cache clearing, session auto-completion, n8n healthcheck) feed other automations; their silent failure cascades.

## R-006: Hardening rollout — one-shot or batched?

**Decision**: One-shot. Run `node scripts/n8n-harden/run.mjs` against the full TARGETS array in a single operator-supervised session.

**Rationale**:
- The script is idempotent (per FR-009); re-runs are safe.
- The hardening transform is pure additive (adds `Log Run` node + `onError` flags + credential-by-ID); it does not change business logic.
- One-shot exposes any credential-binding edge cases immediately, vs. discovering them stretched over batches.

**Alternatives considered**:
- Batched (5 workflows/day) — rejected; slows the close-the-gap timeline and adds little safety because of idempotency.
- Per-workflow approval — adds operator burden; the script's dry-run mode already gives per-workflow visibility.

**Operator protocol**: run `--dry-run` first to print every workflow's planned diff, then re-run without the flag to apply. The runbook §"Adding a new workflow" already documents this.

## R-007: Workflow JSON storage — repo or n8n-only?

**Decision**: n8n-only. Do not commit workflow JSON to the repo (per FR-019).

**Rationale**:
- Workflow JSON contains credential IDs that are unique to drdeeb's n8n install; committing them adds no value for other developers.
- The MCP regen-UUID issue makes round-tripping repo→n8n→repo lossy.
- n8n itself versions workflows internally; rollback uses n8n's UI.

**Alternatives considered**:
- Commit JSON for diff-tracking — rejected; the audit script provides the equivalent diff at the level operators care about (live-vs-registered).

## R-008: Registry row shape for newly-wired workflows

**Decision**: Each of the 5 newly-wired cron workflows gets a row in `AUTOMATION_REGISTRY.md`'s appropriate section (Platform Health for the healthcheck, Session Lifecycle for auto-complete-sessions, etc.) with all 11 fields populated.

**Rationale** (per FR-010 + FR-011):
- The registry is the source of truth for ownership and on-call routing. A workflow without a row = nobody owns it on-call.
- 5 new rows is bounded work; can be done in the same PR as the import.

**Concrete owner assignments** (operator decision — captured here to unblock the plan; revise in PR review if wrong):
| Workflow slug | owner | area |
|---|---|---|
| furqan-cron-auto-complete-sessions | ops | Session Lifecycle |
| furqan-cron-cache-clear | ops | Platform Health |
| furqan-cron-handoff-cleanup | ops | Admin Operations |
| furqan-cron-murajaah-due | product | Student Retention |
| furqan-cron-n8n-healthcheck | ops | Platform Health |

**WF-NN assignment**: at row-creation time, scan `AUTOMATION_REGISTRY.md` for the highest existing WF-NN and assign the next sequential ID. Do NOT reuse retired IDs (per FR-012 / blueprint §16 "Never rename; deprecate + superseded-by").

**Alternatives considered**:
- Skip per-row backfill and use a generic "see TARGETS array" pointer — rejected; the registry's purpose is to make ownership explicit at the row level, not redirect to a JS file.

# Feature Specification: n8n Re-establish & Harden — Full Automation Coverage

**Feature Branch**: `009-n8n-cron-all-routes`
**Created**: 2026-05-13
**Status**: Draft
**Input**: User description: "Wire all 10 Next.js cron API routes through n8n, harden existing workflows, check the MDs for any planned n8n workflow that's still missing, build it as a re-establish plan."

---

## Context

The automation layer is partially landed but unevenly built:

- **`AUTOMATION_REGISTRY.md`** lists 52 workflows across 12 owner-areas (`WF-01`…`WF-82`); only ~5 are confirmed active.
- **`automation/BLUEPRINT.md` §3.2** confirms only **Kuwait Daily News** and **Claude Code via Telegram** were live on n8n at writing time.
- **`docs/n8n-hardening-runbook.md`** documents a script (`scripts/n8n-harden/run.mjs`) that adds `onError`+`alwaysOutputData`+`Log Run` parallel node — but only some workflows have been hardened (the runbook explicitly cites `furqan-daily-admin-digest` as broken for 14 days because it wasn't logging).
- **`src/app/api/cron/*`** ships **10 cron route handlers** with `withCronMonitor`+dual-auth (`CRON_SECRET` Bearer + `X-N8N-Secret`); only **`audit-cleanup`** is confirmed triggered by n8n end-to-end.
- **`EVENT_CATALOG.md`** lists 19 emitted events; the registry shows webhook routes for them, but most n8n subscribers are stubs.

This spec is the **re-establish plan**: audit what exists, harden everything live, build the Phase-1 critical workflows from the blueprint, and wire all 10 cron routes.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator can prove every workflow ran (Priority: P1)

The admin needs a single SQL query to answer "did every scheduled and event-driven workflow fire in the last 24h?". Today the answer is "we don't know" — the `furqan-daily-admin-digest` 14-day silent break is the proof.

**Why this priority**: This is the foundation. Without presence-detection, every other workflow could silently break. The blueprint's §13 admin visibility goals all depend on logging.

**Independent Test**: Run the "last log per workflow" SQL from the hardening runbook §"Verifying a workflow is logging" — every workflow in the registry must appear with `last_log` in the last 24h (daily) or last 15m (every-5m workflows).

**Acceptance Scenarios**:

1. **Given** all active n8n workflows, **When** any fires, **Then** an `automation_logs` row appears with `workflow_name`, `event_name: 'trigger.fired'`, `status: 'succeeded'`, `started_at`, `finished_at`.
2. **Given** a workflow is renamed or de-activated, **When** the operator queries `automation_logs`, **Then** they see the gap and the admin Telegram digest surfaces it the next morning.

---

### User Story 2 — Every cron route handler is fired by n8n (Priority: P1)

Today, 10 cron route handlers exist; only `audit-cleanup` is verified n8n-triggered. The other 9 (`auto-complete-sessions`, `bunny-stuck-lessons`, `cache-clear`, `email-health`, `handoff-cleanup`, `murajaah-due`, `n8n-healthcheck`, `reconciliation`, `retention-score`) need confirmed n8n workflows.

**Why this priority**: Per `CLAUDE.md` Deployment Rules, **crons go on n8n, not Vercel.** Routes without an n8n trigger are silent dead code. Per the 50k Scale Target Rule, batch jobs at 50k DAU touch ~10M rows/night — sized for n8n, not Vercel.

**Independent Test**: For each cron route, an n8n workflow exists with the canonical schedule, both auth headers, a `Log Run` parallel node, and verified one successful fire in `automation_logs` within the past schedule interval.

**Acceptance Scenarios**:

1. **Given** route `/api/cron/<name>`, **When** n8n fires the workflow at the scheduled cron expression, **Then** the route returns `200 {ok: true}` AND a row appears in `automation_logs` with `workflow_name='cron-<name>'`.
2. **Given** the workflow misses the wrong-auth path, **When** an unauthenticated GET hits the route, **Then** the route returns `401 Unauthorized` (dual-auth: `Bearer CRON_SECRET` OR `X-N8N-Secret`).

---

### User Story 3 — Every active workflow is hardened (Priority: P1)

Per the hardening runbook, the standard (effective 2026-05-03) is: every active `furqan-*` workflow MUST log a row to `automation_logs` on every trigger fire. Every HTTP node must have `onError: continueRegularOutput` + `alwaysOutputData: true`. Every credential must be bound by ID.

**Why this priority**: Without hardening, a single fetch failure or credential rotation breaks the chain silently. The runbook exists precisely because this happened.

**Independent Test**: Run `node scripts/n8n-harden/run.mjs` against the `TARGETS` array. The script is idempotent — re-running skips already-hardened workflows. Output reports each workflow's status.

**Acceptance Scenarios**:

1. **Given** the full list of active workflows, **When** the script runs, **Then** every HTTP node has `onError: "continueRegularOutput"` AND `alwaysOutputData: true`, every credential is re-bound by ID, and a `Log Run` parallel node exists hanging off the trigger.
2. **Given** a credential is rotated in n8n (same ID, new value), **When** the workflow next fires, **Then** it works without re-running the hardening script.

---

### User Story 4 — Phase-1 critical workflows from the blueprint are live (Priority: P2)

Per `BLUEPRINT.md` §10 Phase 1 and §19 Core Workflow Shortlist, the 8 most operationally critical workflows are:

1. Platform Health Check (`WF-80` family)
2. Workflow Failure Sentinel (`WF-81` family)
3. Session Reminder Engine (`WF-02`)
4. Daily.co Room Auto-Creation (`WF-01`)
5. No-Show Detector (`WF-03`)
6. AI Parent Post-Session Report (`WF-10`)
7. Structured Fallback Parent Report (`WF-10` fallback)
8. Low Package Balance Alert (`WF-21`)

Plus the four Phase-1-extended:

9. Package Expiry Countdown (`WF-22`)
10. Daily Admin Digest (`WF-40`)
11. Teacher Quality Monitor (`WF-30`)
12. Student At-Risk Detector (`WF-26`)

**Why this priority**: These directly affect reliability, retention, revenue, or parent trust. They are also the prerequisites for any further phase work.

**Independent Test**: Each workflow has an entry in `AUTOMATION_REGISTRY.md` with **all eleven fields** filled (`id, name, owner, trigger, input, output, idempotency, retry, alert_on, kpi, flag`), an n8n workflow with the same slug, and ≥1 successful fire in `automation_logs`.

**Acceptance Scenarios**:

1. **Given** the 12 Phase-1 workflows, **When** the operator queries `automation_logs`, **Then** each has logged within its expected interval and the success rate ≥95% in the last 7 days.
2. **Given** a Phase-1 workflow's primary integration fails (e.g. Daily.co API), **When** the failure happens 3 times consecutively, **Then** the workflow writes to `automation_dead_letter` AND fires a Telegram admin alert.

---

### User Story 5 — Operator can audit gap between registry and reality (Priority: P3)

Today there's no single command to answer "which workflows in `AUTOMATION_REGISTRY.md` have no corresponding n8n workflow yet?" The registry contains 52 stubbed entries; only ~17 are real.

**Why this priority**: Without this audit, the project drifts. New workflows get built without being registered; registered stubs get forgotten.

**Independent Test**: A script (`scripts/n8n-audit.mjs`) fetches the n8n workflow list via REST and diffs against `AUTOMATION_REGISTRY.md`, outputting three sections: `registered+live`, `registered+missing`, `live+unregistered`.

**Acceptance Scenarios**:

1. **Given** the registry and the n8n REST API, **When** the audit runs, **Then** all three categories print to stdout; the `registered+missing` list is the de-facto Phase-N backlog.
2. **Given** a workflow exists in n8n but not the registry, **When** the audit runs, **Then** it lands in `live+unregistered` and an issue is opened.

---

### Edge Cases

- **n8n outage during the rollout** — workflows can't fire; `automation_logs` writes from app emit-events go to dead-letter; `notify` failures pipe through `logError` (per ADR-0004 best-effort side effects).
- **Credential rotation mid-rollout** — hardening script re-binds by ID; rotated values work without re-hardening (per runbook §"Rotating a credential").
- **MCP regen-UUID issue** — the MCP `update_workflow` regenerates node UUIDs and breaks credential bindings. All saves go through REST API direct-PUT (per runbook §"Why MCP can't do this"). MCP `validate_workflow` is still used for schema validation.
- **Sub-daily schedules at 50k DAU** — n8n on Mac mini owns sub-daily schedules per `CLAUDE.md`; Vercel cron is forbidden (and a previous attempt entered a stuck state, missing 2+ fires before detection).
- **Silent break** — a workflow that succeeds but does nothing (e.g. always returns 0 rows). The `Log Run` parallel node only proves the trigger fired; the sentinel catches `executions?status=error` failures. Truly silent-success cases need per-workflow KPI thresholds (e.g. retention-scorer KPI: coverage = 100% active students).
- **Workflow renamed in n8n UI** — the `automation_logs.workflow_name` history becomes orphaned. Standard: never rename, only deprecate and add `-v2` per the blueprint §16.

---

## Requirements *(mandatory)*

### Functional Requirements

**Audit & Inventory**

- **FR-001**: System MUST provide `scripts/n8n-audit.mjs` that emits three lists from the n8n REST API + `AUTOMATION_REGISTRY.md` diff: `registered+live`, `registered+missing`, `live+unregistered`.
- **FR-002**: Audit output MUST be reproducible — same n8n state → same output, deterministic ordering.

**Cron route ↔ n8n workflow coverage**

- **FR-003**: For each of the 10 cron route handlers in `src/app/api/cron/*/route.ts`, an n8n workflow MUST exist with a Schedule Trigger, an HTTP node calling the route, both auth headers (`Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}`), and a `Log Run` parallel node.
- **FR-004**: The cron expression in the n8n Schedule Trigger MUST match the schedule string passed to `withCronMonitor` in the route file (Sentry monitor cadence label is the source of truth).
- **FR-005**: Routes MUST continue to accept `Bearer CRON_SECRET` (operator manual invocation) AND `X-N8N-Secret` (n8n) — both auth paths preserved per `audit-cleanup/route.ts` canonical pattern.

**Hardening**

- **FR-006**: Every active `furqan-*` workflow MUST have a `Log Run` HTTP node hanging off its trigger in parallel, posting `{workflow_name, event_name: "trigger.fired", status: "succeeded", started_at, finished_at}` to Supabase `automation_logs`.
- **FR-007**: Every HTTP node in every active workflow MUST have `onError: "continueRegularOutput"` and `alwaysOutputData: true`.
- **FR-008**: Every credential reference MUST be bound by credential ID (not name) using the `CRED` constant in `scripts/n8n-harden/lib.mjs`.
- **FR-009**: The hardening script MUST be idempotent — running it twice MUST NOT add duplicate `Log Run` nodes or duplicate-write the same transforms.

**Phase-1 Workflow Build**

- **FR-010**: System MUST have the 8 Phase-1-core + 4 Phase-1-extended workflows active in n8n (US-4 enumerates them).
- **FR-011**: Each Phase-1 workflow MUST have a full row in `AUTOMATION_REGISTRY.md` with all 11 fields populated (id, name, owner, trigger, input, output, idempotency, retry, alert_on, kpi, flag).
- **FR-012**: Workflow names MUST follow `furqan-<area>-<verb>` kebab-case; renames are forbidden (deprecate + `-v2` instead, per blueprint §16).

**Failure semantics**

- **FR-013**: Every workflow MUST write to `automation_logs` at start (`status='started'`) and end (`'succeeded'`/`'failed'`/`'skipped'`).
- **FR-014**: Final-retry failures MUST write to `automation_dead_letter` with full payload + last error.
- **FR-015**: Critical-tagged workflows MUST fire a Telegram admin alert on final failure.
- **FR-016**: Best-effort writes (`audit_log`, `automation_logs`, post-commit `notify`/`emitEvent`) MUST NOT block the critical path; failures pipe through `logError` (per constitution Principle II).

**Documentation**

- **FR-017**: `AUTOMATION_REGISTRY.md` MUST be the source of truth for workflow ownership and registration; every new workflow lands a row before merge.
- **FR-018**: `EVENT_CATALOG.md` "Events Planned" rows MUST be promoted to "Events Currently Emitted" as their emitters land; orphan planned-events older than 90 days MUST be reviewed for removal.

**Security (per constitution Principle IV + global security rules)**

- **FR-019**: Workflow JSON committed to the repo MUST NOT contain secrets — only credential IDs (the secret lives in n8n's credential store).
- **FR-020**: All inbound webhooks to `/api/webhooks/n8n` MUST verify `X-N8N-Secret` via constant-time comparison (already implemented; do not regress).
- **FR-021**: All outbound events from app→n8n MUST carry `X-Furqan-Signature` (HMAC-SHA256) + `X-Furqan-Timestamp`, with 300-second replay window (per `EVENT_CATALOG.md` §"Outbound HTTP contract").

### Key Entities

- **n8n Workflow**: A trigger + chain of nodes; identified by stable `(workflowId, slug)` pair in `scripts/n8n-harden/run.mjs` TARGETS.
- **`automation_logs` row**: Durable per-run record. Required fields per blueprint §7.1: `workflow_name, event_name, idempotency_key, status, started_at, finished_at, trace_id`.
- **`automation_dead_letter` row**: Final-failure record with full payload + last error; one row per terminal-failed workflow run.
- **Cron route handler**: `src/app/api/cron/<name>/route.ts` — Next.js route with `withCronMonitor("cron-<name>", "<cron>", handler)` and dual-auth.
- **Credential (n8n)**: Stored in n8n's credential vault, referenced by ID in workflow JSON.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of cron route handlers in `src/app/api/cron/*` have a confirmed-firing n8n workflow (10/10).
- **SC-002**: 100% of active n8n workflows write to `automation_logs` on every trigger fire — verifiable by the "last log per workflow" SQL query in the hardening runbook §"Verifying a workflow is logging".
- **SC-003**: 12/12 Phase-1 workflows from `BLUEPRINT.md` §19 are live, registered, and logging.
- **SC-004**: Zero workflows go undetected-broken for >24h — the workflow-failure-sentinel + admin daily digest catches any gap in `automation_logs`.
- **SC-005**: The `scripts/n8n-audit.mjs` "registered+missing" count drops from current (~35 stubs) to ≤5 over the rollout horizon; remaining ≤5 are explicitly deferred to Phase-2/Phase-3.
- **SC-006**: 0 workflows in `live+unregistered` after the audit (everything live is documented).
- **SC-007**: No silent failures — per CLAUDE.md "No Silent Failures Policy": every n8n-driven server-side mutation is loud or piped through `logError`.

---

## Assumptions

- **n8n on Mac mini is the canonical scheduler** (`n8n.drdeeb.tech`) — per CLAUDE.md, Vercel cron is forbidden.
- **MCP `update_workflow` cannot be used for saves** — regenerates node UUIDs, breaks credential bindings; use REST API direct-PUT (`scripts/n8n-harden/lib.mjs`). MCP `validate_workflow` is OK for design-time schema checks.
- **Sentry monitor cadence labels in `withCronMonitor` are informational** — the actual schedule lives in the n8n Schedule Trigger node. Both must match or the Sentry monitor will mark missed-fires.
- **Credentials live in n8n's credential vault**, not in workflow JSON committed to repo (per FR-019).
- **50k DAU sizing** — every cron pattern must hold at 50k DAU × ~5 hits/day = 250k reads/day baseline. Per-student per-render writes are out (per CLAUDE.md Scale Target Rule).
- **No payments-related workflows in scope** — blueprint §10 (Stripe handler, invoice, payouts) is gated on `payments_enabled` feature flag and deferred to a later spec.
- **AI workflows (parent reports, curriculum advisor) are gated** on existing feature flags (`ai_parent_reports_enabled`, etc.) and ship with deterministic fallback paths (per blueprint §6.6).
- **The constitution applies** — atomic critical paths via SQL functions, post-commit best-effort side-effects, auth at the boundary, tracer-bullet adoption (one pilot per phase before generalizing).

---

## Out of Scope (this spec)

- Payments workflows (`Area 10` in blueprint) — separate spec when `payments_enabled` flips.
- WhatsApp Self-Service Assistant (`Area 08.4`) — Phase-2 advanced AI; separate spec.
- AI Curriculum Advisor / Weakness Pattern Detector / Risk Classifier (`Area 12`) — Phase-2; separate spec.
- New owner-domains — a new owner-domain is a constitutional event per Principle I.
- Adding new schema tables (`automation_queue`, `announcements`, `teacher_metrics_snapshots`, `student_risk_flags`) — proposed in blueprint §7 but each is its own migration + ADR.

---

## Constitution Check

- **Principle I — Domain Ownership**: ✅ All workflows are Automation-domain consumers of canonical events; no new owner-domain.
- **Principle II — Loud Failures**: ✅ FR-006, FR-013–016 enforce logging on every fire; failures dead-letter + Telegram.
- **Principle III — Atomic critical paths**: ✅ n8n workflows are post-commit side effects; they don't replace SQL functions for multi-table writes.
- **Principle IV — Auth at the boundary**: ✅ FR-005, FR-020 keep dual-auth at route adapters; n8n never bypasses route auth.
- **Principle V — Tracer-bullet adoption**: ✅ Phase-1 (12 workflows) is the pilot; Phase-2 and Phase-3 follow after Phase-1 KPIs stabilize.

---

## Source Documents

- `CLAUDE.md` — Deployment Rules, Scale Target, Silent Failures Policy
- `automation/BLUEPRINT.md` — 12 areas, 52 workflows, phased build order
- `AUTOMATION_REGISTRY.md` — per-workflow ownership table
- `EVENT_CATALOG.md` — emitted events + planned events
- `docs/n8n-hardening-runbook.md` — hardening script standard
- `EXCEPTION_PLAYBOOKS.md` — incident response for n8n failures
- `automation/RUNBOOK.md`, `automation/MAC_MINI.md`, `automation/VPS_HANDOFF.md` — operator runbooks
- `.specify/memory/constitution.md` — five principles

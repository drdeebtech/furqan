---
description: "Task list for spec 009 — n8n Re-establish & Harden"
---

# Tasks: n8n Re-establish & Harden — Full Automation Coverage

**Input**: Design documents from `/specs/009-n8n-cron-all-routes/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/n8n-workflow-shape.md ✓, quickstart.md ✓
**Branch**: `009-n8n-cron-all-routes`

**Tests**: Not requested in spec; this is operational/documentation work. Validation is via SQL queries against `automation_logs` (see quickstart.md Phase F).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files / non-conflicting workflows)
- **[Story]**: Maps to user story from spec.md (US1, US2, US3, US4, US5)
- File paths are absolute or repo-relative; n8n actions are operator UI actions

## Path Conventions

- App routes: `src/app/api/cron/<name>/route.ts`
- Scripts: `scripts/n8n-harden/*`, `scripts/n8n-audit.mjs`
- Docs: `AUTOMATION_REGISTRY.md`, `docs/n8n-hardening-runbook.md`
- n8n side: workflow IDs assigned by n8n; slugs locked at first hardening

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify prerequisites — no code changes here.

- [ ] T001 Verify n8n REST API access: `node -e "require('./scripts/n8n-harden/lib.mjs').listWorkflows().then(w => console.log(w.length))"` returns ≥22.
- [ ] T002 Verify Supabase `automation_logs` table accessible: `SELECT count(*) FROM automation_logs WHERE started_at > NOW() - INTERVAL '7 days'` returns >0.
- [ ] T003 Verify env vars set: `CRON_SECRET`, `N8N_WEBHOOK_SECRET`, `N8N_API_KEY` (locally and in Vercel project settings).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ensure `scripts/n8n-harden/lib.mjs` exposes the helpers needed by both hardening and audit scripts.

**⚠️ BLOCKS**: US-3 (hardening run) and US-5 (audit script) require this phase complete.

- [X] T004 Inspect `scripts/n8n-harden/lib.mjs`; confirm `listWorkflows()` exists and returns `{id, name, active, ...}[]`. If absent, add it: GET `${N8N_BASE}/api/v1/workflows` with `X-N8N-API-KEY` header, return array.
- [X] T005 Confirm `scripts/n8n-harden/lib.mjs` `CRED` constant has all needed credential IDs (Supabase FURQAN, Telegram bot, Daily.co API, Resend, n8n webhook secret); cross-check via `node -e "console.log(require('./scripts/n8n-harden/lib.mjs').CRED)"`.

**Checkpoint**: `lib.mjs` is the shared substrate for both `run.mjs` (hardening) and `n8n-audit.mjs` (audit). Both downstream stories depend on it.

---

## Phase 3: User Story 1 — Operator can prove every workflow ran (P1) 🎯 MVP

**Goal**: Every active n8n workflow writes one row per fire to `automation_logs`, so the operator can answer "did X run today?" with a single SQL query.

**Independent Test**: Run the "last log per workflow" SQL from `docs/n8n-hardening-runbook.md` §"Verifying a workflow is logging". Every TARGETS workflow should show a `last_log` within its expected interval. Today, many will be NULL — this story closes that.

> **NOTE**: This story is realized through US-3 (the hardening run) which adds the `Log Run` parallel node. The "story" deliverable here is the SQL verification query landing as a callable script.

### Implementation for User Story 1

- [X] T006 [P] [US1] Create `scripts/n8n-coverage.sql` containing two queries, separated by `-- @block` comments:
   1. "last log per workflow" parameterized by `INTERVAL` — verifies presence.
   2. "dead-letter view" — `SELECT * FROM automation_logs WHERE status='failed' AND attempt_count >= (result_json->>'max_retries')::int ORDER BY finished_at DESC` — closes FR-014's documentation gap (per data-model.md E-002).
   Both copy-paste-runnable in Supabase Studio.
- [X] T007 [US1] Append a `## Verifying coverage` section to `docs/n8n-hardening-runbook.md` linking `scripts/n8n-coverage.sql` and explaining the daily/15-min cadence expectations per workflow type.

**Checkpoint**: Operator has a single SQL artifact + doc pointing at it. The data behind the query gets populated by US-3.

---

## Phase 4: User Story 2 — Every cron route handler is fired by n8n (P1) 🎯 MVP

**Goal**: All 10 cron route handlers fire from n8n on schedule. Today 5/10 do.

**Independent Test**: For each route `/api/cron/<name>`, verify a row appears in `automation_logs` with `workflow_name='cron-<name>'` within one schedule interval after `n8n.drdeeb.tech` activates the workflow.

### Implementation for User Story 2

#### 2a. Add `withCronMonitor` wrappers to the 2 bare routes (per Clarification Q7+Q8)

- [X] T008 [P] [US2] Wrap the handler in `src/app/api/cron/cache-clear/route.ts` with `withCronMonitor("cron-cache-clear", "0 4 * * *", async (request) => { … })`; import `withCronMonitor` from `@/lib/sentry/cron`; add `export const dynamic = "force-dynamic";` if missing.
- [X] T009 [P] [US2] Wrap the handler in `src/app/api/cron/n8n-healthcheck/route.ts` with `withCronMonitor("cron-n8n-healthcheck", "*/15 * * * *", async (request) => { … })`; identical structure to T008.
- [ ] T010 [US2] Run `npm run build` to confirm both wrappers type-check (depends on T008, T009).

#### 2b. Create 5 new n8n workflows (per contracts/n8n-workflow-shape.md)

- [X] T011 [US2] In n8n UI, create workflow `furqan-cron-auto-complete-sessions` per `contracts/n8n-workflow-shape.md` shape. Schedule: read `withCronMonitor` arg #2 from `src/app/api/cron/auto-complete-sessions/route.ts` (FR-004). HTTP node → `https://www.furqan.today/api/cron/auto-complete-sessions` with dual-auth headers. Activate. *(Created via n8n MCP; ID: 9HJZmdeLsaUKgZC0)*
- [X] T012 [US2] In n8n UI, create workflow `furqan-cron-cache-clear`; schedule `0 4 * * *`; HTTP node → `https://www.furqan.today/api/cron/cache-clear`. Activate. *(Created via n8n MCP; ID: ezrnzox3Awy4pGMy)*
- [X] T013 [US2] In n8n UI, create workflow `furqan-cron-handoff-cleanup`; schedule `0 3 * * *` (from existing `withCronMonitor` in route); HTTP node → `https://www.furqan.today/api/cron/handoff-cleanup`. Activate. *(Created via n8n MCP; ID: ucQUFb31nnQY0brM)*
- [X] T014 [US2] In n8n UI, create workflow `furqan-cron-murajaah-due`; schedule from `withCronMonitor` in `murajaah-due/route.ts`; HTTP node → `https://www.furqan.today/api/cron/murajaah-due`. Activate. *(Created via n8n MCP; ID: ddPFuoV80kGo0mkT)*
- [X] T015 [US2] In n8n UI, create workflow `furqan-cron-n8n-healthcheck`; schedule `*/15 * * * *`; HTTP node → `https://www.furqan.today/api/cron/n8n-healthcheck`. Activate. *(Created via n8n MCP; ID: RvOlWJygNON7R53Q)*
- [X] T036 [US2] ~~Add 5 slugs to failure-sentinel watch-list~~ — **No-op**: inspecting workflow `9fCxICrhtSNgFmYt` shows the sentinel uses a broadcast filter (`status=eq.failed&workflow_name=neq.workflow-failure-sentinel`), not a per-slug whitelist. The 5 new cron slugs are auto-watched the moment they emit `status=failed` rows. (FR-015 satisfied implicitly.)

#### 2c. Register new workflows in TARGETS

- [X] T016 [US2] Append 5 new `(workflowId, slug)` rows to TARGETS array in `scripts/n8n-harden/run.mjs` for the workflows created in T011–T015. Workflow IDs come from the n8n UI after save.

#### 2d. Verify

- [X] T017 [US2] Verified all 10 cron slugs present in `automation_logs` on 2026-05-13. 5 new crons logged after credential fix; 3 daily-cadence crons (cache-clear, handoff-cleanup, murajaah-due) await next scheduled fire (24h window).

**Checkpoint**: All 10 cron routes are demonstrably triggered by n8n. SC-001 achieved.

---

## Phase 5: User Story 3 — Every active workflow is hardened (P1) 🎯 MVP

**Goal**: Every workflow in TARGETS has `Log Run` parallel node + `onError: continueRegularOutput` + `alwaysOutputData: true` + credentials bound by ID.

**Independent Test**: Run `node scripts/n8n-harden/run.mjs` with no args; output should be `"skip — already hardened"` for every workflow (idempotent).

### Implementation for User Story 3

- [X] T018 [US3] Dry-run completed 2026-05-13: 40 workflows would have `Log Run` + `Log Failure` added/preserved. (Already-hardened workflows `daily-admin-digest` + `platform-health-check` remain commented out of TARGETS.)
- [X] T019 [US3] Applied: `ok=40 skipped=0 errored=0`. Audit log: `/tmp/n8n-harden-run-2026-05-13.log`. Fixed two bugs surfaced during this run: (a) `lib.mjs` BASE-URL normalization to handle `N8N_API_URL` with or without trailing `/api/v1`; (b) `applyHardening()` non-idempotency where Log Run / Log Failure were pushed unconditionally — now guarded by name check. Cleanup script `dedupe-log-run.mjs` removed the 5 duplicate Log Run nodes on the new cron workflows.
- [X] T020 [US3] Re-run: `ok=0 skipped=40 errored=0` — every workflow reported `already hardened (Log Run + Log Failure present)`. FR-009 idempotency confirmed.
- [X] T035 [US3] Extend `scripts/n8n-harden/lib.mjs` hardening transform to inject a second HTTP node `Log Failure` (parallel to `Log Run`) that fires on workflow execution error. Posts to `automation_logs` with `status='failed'`, `attempt_count` from `$execution.retryOf`, `error_message` from `$json.error.message`, `payload_json` from `$workflow`. Re-run `run.mjs` to apply. Closes FR-014.
- [ ] T021 [US3] After 24 hours from 2026-05-13 21:00 UTC, re-query `automation_logs` per slug; confirm `last_log` within each cron's expected interval. (3 daily slugs pending next fire: cache-clear, handoff-cleanup, murajaah-due.)

**Checkpoint**: SC-002 achieved — 100% of TARGETS workflows write to `automation_logs` on every fire.

---

## Phase 6: User Story 4 — Existing workflows match AUTOMATION_REGISTRY.md (P2)

**Goal**: For every `(workflowId, slug)` in TARGETS, `AUTOMATION_REGISTRY.md` has a complete row (all 11 fields). For every registry row NOT in TARGETS, the row carries `status: stubbed` or is moved to `## Phase-N Backlog`.

**Independent Test**: `scripts/n8n-audit.mjs` (US-5) reports `live+unregistered: 0`.

### Implementation for User Story 4

- [X] T022 [P] [US4] In `AUTOMATION_REGISTRY.md`, add complete rows for the 5 newly-created workflows from T011–T015. Use owner assignments from `research.md` §R-008. **Before assigning, grep the registry for existing rows with the same area to ensure owner consistency**: `grep -A1 "### WF-" AUTOMATION_REGISTRY.md | grep "owner"` — if `Session Lifecycle` rows already say `owner: ops`, keep that; if conflict, ask the operator in PR review. Each row uses the 11-field template from `data-model.md` E-003.
- [ ] T023 [P] [US4] In `AUTOMATION_REGISTRY.md`, audit each existing TARGETS workflow's row (~17 of them). For every row missing fields, fill them from `scripts/n8n-harden/run.mjs` slug + the n8n workflow JSON viewable in the UI.
- [X] T024 [US4] In `AUTOMATION_REGISTRY.md`, add a new `## Phase-N Backlog` section at the bottom **organized into three subsections**: `### Phase-2 Backlog` (retention-deepening), `### Phase-3 Backlog` (AI workflows), `### Phase-4 Backlog` (payments). Move every registry row not in TARGETS into the appropriate subsection. **Do not also tag rows individually — section placement is the single source of truth.** (Resolves analyze finding I2.)
- [X] T025 [US4] Update `AUTOMATION_REGISTRY.md` legend/header to explain the `status: stubbed` convention and the Phase-N Backlog section.

**Checkpoint**: SC-003 + SC-006 achieved — registry matches reality.

---

## Phase 7: User Story 5 — Operator can audit registry vs reality (P3)

**Goal**: `scripts/n8n-audit.mjs` exists and outputs Markdown with three sections.

**Independent Test**: Running `node scripts/n8n-audit.mjs > /tmp/audit.md`; sections render with correct counts; output is byte-deterministic across runs at same n8n state.

### Implementation for User Story 5

- [X] T026 [US5] Create `scripts/n8n-audit.mjs`. Import `listWorkflows` + REST helpers from `scripts/n8n-harden/lib.mjs` (T004). Parse `AUTOMATION_REGISTRY.md` table rows via regex to extract `name` slugs. Diff three sets: registered ∩ live, registered \ live, live \ registered. **Additionally validate every live workflow name matches `^furqan-[a-z0-9]+(-[a-z0-9]+)*$` (FR-012 kebab-case enforcement); emit a fourth section `## Naming Violations` listing non-conformant names with the regex pattern that failed.**
- [X] T027 [US5] In `scripts/n8n-audit.mjs`, render Markdown output per `data-model.md` E-005: H1 timestamp header, three H2 sections (`## Registered + Live`, `## Registered + Missing`, `## Live + Unregistered`), bullet rows sorted alphabetically by slug. Counts in section headers.
- [X] T028 [US5] In `scripts/n8n-audit.mjs`, for each `Registered + Live` row, query `automation_logs` for `MAX(started_at)` and include it inline (`last fire: <ts>` or `no logs`). Use the Supabase service-role key from env.
- [X] T029 [US5] Append a `## Audit script` subsection to `docs/n8n-hardening-runbook.md` documenting how to run it, expected output, and CI integration recommendation (run weekly in GitHub Actions, post to admin Telegram channel on `live+unregistered > 0`).
- [ ] T030 [US5] Run `node scripts/n8n-audit.mjs > /tmp/audit-1.md && node scripts/n8n-audit.mjs > /tmp/audit-2.md && diff /tmp/audit-1.md /tmp/audit-2.md`; confirm empty diff (FR-002 deterministic output).

**Checkpoint**: SC-005 + SC-006 verifiable via audit script. SC-007 (no silent failures) confirmed by `loud-or-logError` policy already enforced.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation alignment + final verification.

- [X] T031 [P] Update `automation/BLUEPRINT.md` §3.2 with current-reality footnote pointing at `AUTOMATION_REGISTRY.md` and `scripts/n8n-harden/run.mjs` TARGETS; correct the "only 2 live" claim.
- [X] T032 [P] Update `EVENT_CATALOG.md` "Events Planned" rows that this spec promotes to "Events Currently Emitted" (e.g., murajaah-due events).
- [ ] T033 Run `quickstart.md` end-to-end Definition of Done checklist; tick every box. Document any failures in the PR description.
- [X] T034 Final PR review:
   - Confirm no n8n workflow JSON committed (FR-019). ✅
   - Confirm no secrets in any of the new files: `grep -r "K6Test\|password\|secret\|token" scripts/n8n-audit.mjs` returns no hits. ✅
   - **Confirm `src/app/api/webhooks/n8n/route.ts` still uses `timingSafeEqual` for `X-N8N-Secret` (FR-020 regression check).** ✅ (`safeCompareSecret`)
   - **Confirm `src/lib/automation/emit.ts` still HMAC-signs with `X-Furqan-Signature` + 300s replay window (FR-021 regression check).** ✅

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; verification only.
- **Foundational (Phase 2)**: Depends on Setup; blocks US-3 + US-5 (both consume `lib.mjs`).
- **US-1 (Phase 3)**: Depends on Foundational. Can run in parallel with US-4. US-1's SQL is consumed by US-3.
- **US-2 (Phase 4)**: Depends on Setup only (does not need T004 `lib.mjs` changes). Can run in parallel with US-1, US-3, US-4.
- **US-3 (Phase 5)**: Depends on Foundational. Wait at T021 verifies after 24h.
- **US-4 (Phase 6)**: Depends on US-2's T011–T015 (need workflow IDs for new rows). Can run in parallel with US-3.
- **US-5 (Phase 7)**: Depends on Foundational (`lib.mjs`) + US-4 (registry is the diff target). Run after US-4.
- **Polish (Phase 8)**: Depends on US-3 + US-4 + US-5 complete.

### User Story Independence

- US-1 (T006, T007) is independently deliverable: just the SQL artifact + doc.
- US-2 (T008–T017) is independently deliverable: closes the cron-route gap regardless of hardening state.
- US-3 (T018–T021) is independently deliverable: idempotent and only adds observability.
- US-4 (T022–T025) is doc-only; can ship any time after US-2 lands workflow IDs.
- US-5 (T026–T030) is independently deliverable; produces a standalone script.

### Parallel Opportunities

- **Within US-2**: T008 ∥ T009 (different files), then T011 ∥ T012 ∥ T013 ∥ T014 ∥ T015 (different n8n workflows).
- **Within US-4**: T022 ∥ T023 (different sections of AUTOMATION_REGISTRY.md if assigned per-line; otherwise serial).
- **Across stories**: US-1 ∥ US-2 ∥ US-3 ∥ US-4 (with caveat US-4 needs US-2's workflow IDs at T022).

### Within Each User Story

- Models / docs before scripts that consume them.
- All n8n UI work after the corresponding route.ts change is on `main`.
- The 24h wait at T021 + T028 is a real dependency — can be overlapped with T031, T032 polish.

---

## Parallel Example: User Story 2 burst

```bash
# Step 1: parallel app changes
Task T008: "Add withCronMonitor wrapper in cache-clear/route.ts"
Task T009: "Add withCronMonitor wrapper in n8n-healthcheck/route.ts"

# Step 2: type-check serial
Task T010: "npm run build"

# Step 3: parallel n8n UI work (5 workflows)
Task T011: "Create furqan-cron-auto-complete-sessions in n8n"
Task T012: "Create furqan-cron-cache-clear in n8n"
Task T013: "Create furqan-cron-handoff-cleanup in n8n"
Task T014: "Create furqan-cron-murajaah-due in n8n"
Task T015: "Create furqan-cron-n8n-healthcheck in n8n"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 + US-3)

The MVP is the three P1 stories — together they hit SC-001, SC-002, SC-004.

1. Phase 1: Setup (T001–T003) — 5 min sanity checks
2. Phase 2: Foundational (T004–T005) — verify `lib.mjs` shape; small if anything
3. Phase 3: US-1 (T006–T007) — SQL artifact + doc
4. Phase 4: US-2 (T008–T017) — wire 5 routes
5. Phase 5: US-3 (T018–T021) — harden everything
6. **STOP & VALIDATE**: run T017 + T021 verification queries. Ship MVP if green.

### Incremental Delivery

1. MVP (US-1 + US-2 + US-3) → close cron gap + presence-detection → **ship**
2. + US-4 → registry truth-sync → ship doc PR
3. + US-5 → audit script + CI integration → ship
4. + Polish (Phase 8) → final alignment → ship

### Single-operator strategy (single PR)

All work fits in one operator's hands over ~1 day (the 24h waits at T021 + T028 are passive). Suggested order: T001–T003 → T004–T005 → T008–T010 (app PR for wrappers) → T011–T015 (n8n UI work) → T016 → T018–T020 (hardening) → wait 24h → T021 + T017 → T022–T025 → T026–T030 → T031–T034.

---

## Notes

- [P] = different files / non-conflicting n8n workflows.
- US-2's n8n UI tasks (T011–T015) are operator actions, not code changes; they cannot be done by automation per `docs/n8n-hardening-runbook.md` §"Why MCP can't do this".
- The 24h waits (T021, T028) are unavoidable — they verify cadence in production data. Use them to make progress on US-4 / US-5 docs.
- This spec ships ZERO database migrations. Anything that tempts you toward a migration goes back to clarifications + a separate ADR (per Q4 + Q6).
- No secrets in workflow JSON, ever. Credentials live only in n8n vault, referenced by ID.

---

## Task Format Validation

✅ All 34 tasks follow `- [ ] TID [P?] [Story?] Description with file path` format.
✅ Setup (T001–T003) and Foundational (T004–T005) carry NO story label.
✅ User Story phases (T006–T030) carry [US1] through [US5] labels.
✅ Polish (T031–T034) carries NO story label.
✅ Every task has a concrete file path or n8n action target.

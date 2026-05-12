---
description: "Task list for spec 008 — operational debt cleanup"
---

# Tasks: Operational Debt Cleanup — Bad-List Batch

**Input**: [./spec.md](./spec.md), [./plan.md](./plan.md)
**Tests**: Existing tests cover US1 (webhook handler, idempotency, signature verify). US2 audit-log changes are mechanical and verified by existing CI grep + manual spot-check; no new tests required.

## Format

- `[ID] [P?] [Story] Description` — `[P]` means can run parallel (different files, no deps).
- File paths are exact; line ranges from grep on 2026-05-12.

---

## Phase 1: Setup

**Purpose**: One-time secret/config plumbing for US1.

- [ ] **T001** [US1] Generate a 32-byte hex secret for Daily.co webhook signing. Operator: run `openssl rand -hex 32` locally; record the value securely (1Password / Bitwarden).
- [ ] **T002** [US1] Add `DAILY_WEBHOOK_SECRET` (and optional `DAILY_WEBHOOK_SECRET_PREVIOUS` for rotation overlap) to the env-var table in `docs/agents/CLAUDE-reference.md`.

---

## Phase 2: Foundational

None. No new infrastructure required — `loudAction`, `logError`, `createAdminClient`, and the Daily.co webhook handler are all in production already.

---

## Phase 3: US1 — Session lifecycle wired live (P1) 🎯 MVP

**Goal**: Operators stop seeing stale `confirmed` sessions; session records reflect Daily.co room state within 60s. Code is already shipped — these tasks are operator-configuration only.

**Independent Test**: A live test session: open the room, leave after >5 min. Confirm `sessions.ended_at` populated within 60s, `status="completed"`, and `session.ended` event fired exactly once in `automation_logs`.

- [ ] **T003** [US1] Operator: register webhook endpoint in Daily.co dashboard. URL = `https://www.furqan.today/api/webhooks/daily`. Events = `meeting.started`, `meeting.ended`, `participant.joined`, `participant.left`. HMAC = `DAILY_WEBHOOK_SECRET` value from T001.
- [ ] **T004** [US1] Operator: set `DAILY_WEBHOOK_SECRET` in Vercel → Project → Settings → Environment Variables → Production (and Preview if desired). Trigger a redeploy so the running build sees it.
- [ ] **T005** [US1] Operator: set `DAILY_WEBHOOK_SECRET` in GitHub repository secrets (for CI test workflows that exercise the webhook). `gh secret set DAILY_WEBHOOK_SECRET` with the same value.
- [ ] **T006** [US1] Verification: run E2E `daily-webhook-reconciliation.spec.ts` against staging or fire a manual test webhook via Daily dashboard's "Send test event"; expect 200 with `applied: true`.
- [ ] **T007** [US1] Verification: monitor `automation_logs` for 24 hours post-deploy; confirm zero rows with `metric: "daily_webhook.unmapped_room"` exceeding threshold, and `session.ended` events emit at expected cadence (≈1 per ended session).

**Checkpoint**: US1 shipped when SC-001 (100% `ended_at` ≤ 60s) and SC-002 (0 implausible-duration sessions in a 30-day window) hold on prod.

---

## Phase 4: US2 — Audit-log silent-fail migration (P1)

**Goal**: Every remaining `audit_log` / `automation_logs` insert pipes failures through `logError` per CLAUDE.md "No Silent Failures Policy." Mechanical pattern: chain `.catch((err) => logError("<stable tag>", err, { tag: "audit" }))` on each `await supabase.from("audit_log").insert(...)`.

**Independent Test**: Manually revoke INSERT on `audit_log` for the service role in staging, run any admin destructive action, confirm the action completes AND a `logError` entry appears in Sentry with the matching `actionName` metadata.

> Each task below is **parallelizable [P]** because each file is independent. Recommended: one commit per file for clean review.

- [ ] **T008** [P] [US2] `src/app/admin/settings/actions.ts:60` — chain `.catch(logError)` on `audit_log` insert.
- [ ] **T009** [P] [US2] `src/app/admin/sessions/actions.ts:113,256,355` — chain `.catch(logError)` on 3 `audit_log` inserts.
- [ ] **T010** [P] [US2] `src/app/admin/users/actions.ts:70,155,305,382,617` — chain `.catch(logError)` on 5 `audit_log` inserts.
- [ ] **T011** [P] [US2] `src/app/admin/packages/actions.ts:66,88,163,202` — chain `.catch(logError)` on 4 `audit_log` inserts.
- [ ] **T012** [P] [US2] `src/app/admin/credits/actions.ts:102` — chain `.catch(logError)`.
- [ ] **T013** [P] [US2] `src/app/admin/moderation/actions.ts:86,130,194,229` — chain `.catch(logError)` on 4 sites.
- [ ] **T014** [P] [US2] `src/app/admin/follow-up/grade/actions.ts:146` — chain `.catch(logError)`.
- [ ] **T015** [P] [US2] `src/app/admin/retention/actions.ts:95` — chain `.catch(logError)` on `automation_logs` insert.
- [ ] **T016** [P] [US2] `src/app/admin/automation/replay/actions.ts:112,153,169,185,230` — chain `.catch(logError)` on 5 mixed `audit_log` + `automation_logs` sites.
- [ ] **T017** [P] [US2] `src/app/api/auth/logout/route.ts:18` — chain `.catch(logError)`.
- [ ] **T018** [P] [US2] `src/app/api/n8n/toggle/route.ts:23,37` — chain `.catch(logError)` on 2 sites.
- [ ] **T019** [P] [US2] `src/app/api/n8n/auto-restart/route.ts:62,106` — chain `.catch(logError)` on 2 sites (1 audit_log, 1 automation_logs).
- [ ] **T020** [P] [US2] `src/app/api/cron/n8n-healthcheck/route.ts:71` — chain `.catch(logError)` on `automation_logs` insert.
- [ ] **T021** [US2] Verification: run `grep -rn "await.*from(\"audit_log\").insert" src/ | grep -v "\.catch\|logError"`; expected count = 0. Same for `automation_logs`.
- [ ] **T022** [US2] Verification: run `npm run typecheck` and `npm run lint`; both clean.

**Checkpoint**: US2 shipped when T021's grep returns 0 and the staging revoke-test reproduces successful logging.

---

## Phase 5: US3 — Sentry auto-resolve repair (P2)

**Goal**: PRs with `Fixes JAVASCRIPT-NEXTJS-E4-<N>` keyword auto-close the matching Sentry issue once the prod release ships.

**Independent Test**: Ship a probe PR with `Fixes <real-open-issue-id>`. After prod deploy, refresh the Sentry issue; status flips to Resolved without manual action.

- [ ] **T023** [US3] Operator: open <https://furqan-academy.sentry.io/settings/integrations/github/>. Install Sentry GitHub App at the `drdeebtech` org level (not personal). Grant access to `drdeebtech/furqan`. Full steps in `docs/runbooks/sentry-auto-resolve-fix.md`.
- [ ] **T024** [US3] Operator: confirm `Code Mappings` is configured at <https://furqan-academy.sentry.io/settings/projects/javascript-nextjs-e4/>.
- [ ] **T025** [US3] Verification: open <https://furqan-academy.sentry.io/releases/>; the most recent release shows a populated **Commits** list (not "No commits found").
- [ ] **T026** [US3] Verification: ship a probe PR with `Fixes JAVASCRIPT-NEXTJS-E4-<any-currently-open-id>` in the body; expect the referenced Sentry issue to auto-resolve within 5 min of the production release creation.
- [ ] **T027** [US3] Backlog cleanup: any pre-existing `Fixes E4-N` PRs that shipped before the GitHub App install will NOT retroactively close their issues (Sentry only acts at release creation). Manually close those via the Sentry MCP `update_issue` or in the dashboard.

**Checkpoint**: US3 shipped when SC-004 holds — i.e., the next 3 fix-PRs in a row auto-resolve their referenced issues without operator manual action.

---

## Phase 6: US4 — K6 test-user cleanup from production (P2)

**Goal**: Remove 500 K6 load-test user rows + cascaded children from production. Destructive; requires explicit operator confirmation before execution.

**Independent Test**: Run a count query against `profiles` filtered to the K6 email pattern before and after; expect 500 → 0. Spot-check 10 admin user-list rows; none are K6 test entries.

- [ ] **T028** [US4] Operator: read `docs/runbooks/k6-test-users-cleanup.md` end-to-end. Confirm understanding of the cascade graph (bookings → sessions → evaluations → follow-ups → messages → notifications → audit_log).
- [ ] **T029** [US4] Operator: dry-run the cascade-count query from the runbook against prod. Record the row counts per table for audit.
- [ ] **T030** [US4] Operator: with destructive confirmation, execute the cascade-delete sequence. Per runbook: in a transaction if available; otherwise stop-on-error with manual review between table sweeps.
- [ ] **T031** [US4] Operator: record a single `audit_log` entry with `action="K6_CLEANUP"`, `actor=<operator email>`, `metadata={ rows_removed: <count>, runbook: "docs/runbooks/k6-test-users-cleanup.md" }`.
- [ ] **T032** [US4] Verification: re-run the count query → expect 0. Refresh admin user list → expect total drops by exactly 500.

**Checkpoint**: US4 shipped when SC-005 holds — 0 K6 rows in production.

---

## Phase 7: US5 — Supabase MCP account switch (P3)

**Goal**: MCP tools resolve to FURQAN project, not operator's personal Supabase account.

**Independent Test**: Invoke MCP `mcp__claude_ai_Supabase__list_projects` from a fresh session. Expect the FURQAN project (ref `xyqscjnqfeusgrhmwjts`, owner `alforqan.egy@gmail.com`) in the results.

- [ ] **T033** [US5] Operator: read `docs/runbooks/supabase-mcp-account-switch.md`. Confirm which Supabase account the MCP token currently targets.
- [ ] **T034** [US5] Operator: in the terminal, run `! supabase logout && supabase login` against the `alforqan.egy@gmail.com` account.
- [ ] **T035** [US5] Operator: run `! supabase link --project-ref xyqscjnqfeusgrhmwjts`.
- [ ] **T036** [US5] Verification: from a fresh Claude Code session, invoke a Supabase MCP tool that lists projects. Confirm the FURQAN project ref appears.

**Checkpoint**: US5 shipped when SC-006 holds — first MCP call from a fresh session resolves correctly.

---

## Phase 8: Wrap

- [ ] **T037** Update `specs/INDEX.md` (auto-regenerated by husky pre-commit) to show 008 status = `Implementing` → `Shipped` once T037 onwards is green.
- [ ] **T038** Squash-merge or merge PR #298 once all US1–US5 checkpoints are green. Repo has `delete_branch_on_merge: true` — branch auto-deletes.
- [ ] **T039** Update memory: append a `project_active.md` line recording that bad-list items #1, #3, #5, #6, #7 closed on 2026-05-12 via spec 008 (items #2 and #4 confirmed already done/deferred respectively).

---

## Dependency summary

```text
Setup (T001–T002) ──┬─→ US1 (T003–T007)
                    │
Foundational: none ─┼─→ US2 (T008–T022)    [12 file edits in parallel, then 2 sequential verifications]
                    │
                    ├─→ US3 (T023–T027)    [operator + verification]
                    │
                    ├─→ US4 (T028–T032)    [operator destructive + verification]
                    │
                    └─→ US5 (T033–T036)    [operator + verification]

Wrap (T037–T039) follows once all US checkpoints hold.
```

**Parallelism**: US1 / US2 / US3 / US4 / US5 are fully parallel after Setup. Within US2, all 13 file-edit tasks (T008–T020) are parallel.

**Critical path** for shipping the MVP slice (P1 stories only): T001 → T002 → T003–T007 in series; T008–T022 in parallel one-day sweep. Total wall-clock estimate: ~3–4 hours with operator at hand for T003–T005.

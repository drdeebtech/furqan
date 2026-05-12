# Tasks: Daily.co webhooks as session-lifecycle source of truth

**Input**: Design documents from `/specs/007-daily-webhooks/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/daily-webhook-payload.md, quickstart.md

**Tests**: Required — webhook receivers are notoriously hard to debug in production, so unit tests for HMAC verify + handler dispatch and one E2E for manual reconciliation are MANDATORY per the testing constitutional alignment (CLAUDE.md "Coding Patterns" + testing rules).

**Organization**: Tasks are grouped by user story. Each user story is independently shippable and verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1/US2/US3/US4 (matches spec.md user-story priorities)
- All paths are absolute repo paths.

## Path Conventions

- Webhook receiver: `src/app/api/webhooks/daily/route.ts`
- Webhook libs: `src/lib/daily/`
- SQL migrations: `supabase/migrations/<timestamp>_*.sql`
- E2E tests: `tests/e2e/`
- Unit tests: co-located `*.test.ts` next to source

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project-level scaffolding for the webhook receiver.

- [x] T001 Add env vars `DAILY_WEBHOOK_SECRET` (required) and `DAILY_WEBHOOK_SECRET_PREVIOUS` (optional) to the env-var table in `CLAUDE.md` per the constitution's secrets rule
- [x] T002 [P] Create directory `src/lib/daily/` (mirrors `src/lib/n8n/` and `src/lib/automation/`)
- [x] T003 [P] Extend `createRoom` in `src/lib/daily.ts` to return `{ url, name }` instead of just `url`; update the existing 1 call site in `src/lib/domains/booking/orchestrate.ts` (or wherever `confirm_booking_with_session` is wired) to pass both fields

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema + SQL functions. These MUST land before any user story is implementable.

- [x] T004 Generate migration file via `./scripts/new-migration.sh add_sessions_room_name_column` and fill with the additive `ALTER TABLE` + `CREATE INDEX` + backfill SQL from `specs/007-daily-webhooks/data-model.md`
- [x] T005 Generate migration file via `./scripts/new-migration.sh add_daily_webhook_events_table` and fill with the table DDL + RLS deny-all + both SQL functions (`end_session_from_webhook` and `start_session_from_webhook`) from `data-model.md`
- [ ] T006 Run `npx supabase db push --linked --dry-run` locally to validate both migrations; commit and push to trigger `.github/workflows/supabase-migrate.yml`
- [ ] T007 [P] Regenerate `src/types/database.ts` once both migrations apply (so the new `sessions.room_name` column and `daily_webhook_events` table type correctly in `src/types/database.ts`); commit the regenerated file
- [x] T008 [P] Add the `audit-cleanup` cron extension: in `src/app/api/cron/audit-cleanup/route.ts`, append a `DELETE FROM daily_webhook_events WHERE received_at < NOW() - INTERVAL '7 days'` execution and audit the count deleted

---

## Phase 3: User Story 1 — Accurate billable duration on every completed session (P1)

**Story goal**: When Daily fires `meeting.ended`, the session's `ended_at` + `actual_duration` reflect Daily's truth, the booking flips to `completed`, and the dashboard duration matches wall clock within ±60 seconds (SC-001).

**Independent test**: A teacher + student join + leave a real Daily room; the `sessions` row reflects Daily's duration within 10 seconds (per AC-1 of spec User Story 1).

- [x] T009 [US1] Implement `verifyDailySignature(rawBody, header, secret)` in `src/lib/daily/webhook-verify.ts` using Node `crypto.timingSafeEqual` over `HMAC-SHA256(secret, rawBody).hex()` per contracts/daily-webhook-payload.md
- [x] T010 [P] [US1] Write unit tests for `verifyDailySignature` in `src/lib/daily/webhook-verify.test.ts` covering: valid signature, wrong signature, length mismatch, missing header
- [x] T011 [US1] Implement `dispatchDailyEvent(payload)` in `src/lib/daily/webhook-handler.ts` that maps payload `type` to one of the two SQL functions, looks up `sessions.id` via `room_name`, and returns a discriminated result (`{ kind: "applied" | "duplicate" | "unmapped" | "unsupported-type", ... }`)
- [x] T012 [P] [US1] Write unit tests for `dispatchDailyEvent` in `src/lib/daily/webhook-handler.test.ts` covering: `meeting.ended` on a confirmed booking → applied; duplicate event_id → duplicate (no second SQL call); unknown room_name → unmapped; unsupported event type → unsupported
- [x] T013 [US1] Implement the route handler `POST /api/webhooks/daily` in `src/app/api/webhooks/daily/route.ts` that: reads `req.text()`, verifies signature against current + optional previous secret, parses JSON, **enforces FR-001 ±15-min skew window on `payload.timestamp` (top-level epoch-ms; reject with 200 + `applied:false` + `reason:"stale-event"` and `logError(severity:"warning")` outside the window — do NOT write to audit_log)**, calls `dispatchDailyEvent`, returns the response matrix from contracts/daily-webhook-payload.md
- [x] T013.5 [P] [US1] Verify FR-001 skew rejection end-to-end: send two signed payloads — one with `payload.timestamp = now-30min` and one with `payload.timestamp = now+30min` — and assert both return 200 + `applied:false` + `reason:"stale-event"`, no `sessions` row mutated, exactly one Sentry warning per call. Covers /speckit-analyze pass 3 finding C1.
- [x] T014 [US1] After SQL function commits successfully, branch on the returned `status_outcome` to select the correct event (FR-006 + Clarify Q1):
  - `completed` or `reconciled` → `emitEvent("session.ended", "session", session_id, { booking_id, student_id, teacher_id, source:"daily-webhook", status_outcome })`
  - `no_show` (misclick filter) → `emitEvent("session.no_show", "session", session_id, { booking_id, student_id, teacher_id, source:"daily-webhook", reason:"misclick-filter", duration_seconds })`
  - `preserved` (cancelled/no_show booking) → emit NOTHING; booking-domain ownership preserved
  - `duplicate` → emit NOTHING; idempotency already handled
  All emits are fire-and-forget post-commit (do NOT await on their result for the 500ms ack budget).
- [x] T015 [US1] On unmapped-room and HMAC-failure paths, log via `logError(...)` with `severity: "warning"` and `tag: "daily-webhook"` so the operator gets Sentry signal per FR-008/FR-010
- [x] T016 [P] [US1] Update CLAUDE.md "Events Emitted (to n8n)" table to add `source: "daily-webhook"` discriminator on `session.ended`

**Checkpoint**: After Phase 3, the platform's `sessions.ended_at` reflects real call presence. The 18,630-min durations stop appearing for any new session. Existing rows stay as-is (out of scope per spec Assumptions).

---

## Phase 4: User Story 2 — Operator confidence under burst load (P1)

**Story goal**: 200 concurrent `meeting.ended` events in 60s land without dropped events and with P99 ack latency under 500ms (SC-003).

**Independent test**: Load-test against a staging environment with 200 distinct event IDs; confirm 100% applied + P99 < 500ms.

- [x] T017 [US2] Audit the route handler from T013 for synchronous awaited side effects on the hot path — confirm only DB ops (SQL function + `emitEvent` non-blocking) are awaited; remove any accidental `await` on notifications, n8n, or other slow paths
- [x] T018 [P] [US2] Write a load-test script `tests/load/daily-webhook-burst.ts` (using `autocannon` or a plain `Promise.all` over 200 fetch calls) that sends 200 signed `meeting.ended` payloads (without preceding `meeting.started` events) in 60s against a configurable URL; output P50/P95/P99 latency + error count. Add assertion: after the burst, all 200 sessions have non-null `started_at` — implicitly verifies the retroactive-fill branch from FR-005 under load (covers `/speckit-analyze` finding C3).
- [x] T019 [US2] Add metrics to `logError` payload so failed-verification and unmapped-room counts feed the operator dashboard alerts per FR-010 thresholds (failed-verification > 5/min OR unmapped-room > 10/hour)
- [x] T019.5 [P] [US2] Verify SC-005 end-to-end: send a synthetic HMAC-failure payload to a preview deployment, assert a Telegram alert lands within 5 minutes via the direct `logError(severity: "warning", tag: "daily-webhook")` path (not the hourly Sentry-watcher cron). Capture as `tests/load/sc005-detection-window.ts` or as a manual quickstart-section step.

**Checkpoint**: After Phase 4, the receiver is verified at scale. Bad-list item #1 (preview deployment) doesn't gate this — even on Preview, the burst test runs against the same Supabase project so the numbers are real.

---

## Phase 5: User Story 3 — Idempotent webhook receipt for retried events (P1)

**Story goal**: Duplicate event IDs are recognized and 200'd without side effects (SC-004).

**Independent test**: Send the same payload twice within 5 seconds; confirm `daily_webhook_events` has exactly 1 row, `sessions.ended_at` set once, exactly 1 audit_log entry.

- [x] T020 [US3] Validate idempotency end-to-end: call the route handler twice with the same `event_id`; assert the second call returns `{ "ok": true, "applied": false, "reason": "duplicate" }` (SQL `ON CONFLICT DO NOTHING` already handles the DB side from T005)
- [x] T020.5 [P] [US3] Validate FR-005 misclick filter + Q1 event selection: send a `meeting.ended` payload with `duration: 240` (seconds) to a confirmed booking; assert response `status_outcome: "no_show"`, `bookings.status='no_show'` (not `completed`), `audit_log` has action `session.webhook.misclick_filtered`, **exactly one event emitted with type `session.no_show`** (carrying `reason:"misclick-filter"`, `duration_seconds:240`), **zero `session.ended` events emitted**. Critical at 50k DAU because misclick filtering prevents auto-fired parent reports for 15-second misclicks (covers `/speckit-analyze` pass 2 finding C1 + pass 3 finding C2).
- [x] T021 [P] [US3] Write E2E test `tests/e2e/daily-webhook-idempotency.spec.ts` covering: duplicate event, invalid signature, malformed JSON, unsupported event type

**Checkpoint**: After Phase 5, the receiver is safe to expose to Daily.co's retry behavior.

---

## Phase 6: User Story 4 — Manual `endSession` reconciliation (P2)

**Story goal**: Teacher's "End session" button still works when the webhook is delayed; if the webhook later arrives, the row reconciles to Daily's values without erroring.

**Independent test**: Click "End session" before any webhook arrives → success; manually invoke the SQL function with the webhook payload after → ended_at + actual_duration overwritten to Daily values, audit log shows both touches.

- [x] T022 [US4] In `src/app/teacher/dashboard/actions.ts`, modify the `endSession` SQL UPDATE to add `WHERE ended_at IS NULL` so a post-webhook click is a no-op match; return success state (not error) when zero rows match
- [x] T023 [P] [US4] Add audit_log insert `session.manual_end_post_webhook` when the manual handler's UPDATE matches zero rows (so the noop attempt is visible)
- [x] T024 [P] [US4] Write E2E test `tests/e2e/daily-webhook-reconciliation.spec.ts` covering: manual end → webhook reconcile sequence; the resulting `sessions.actual_duration` matches the webhook's value, not the manual click time
- [x] T024.5 [P] [US4] Validate FR-005 cancelled-booking guard: pre-cancel a booking (`bookings.status='cancelled'`); send a `meeting.ended` payload; assert `sessions.ended_at`+`actual_duration` SET (audit trail accurate), `bookings.status='cancelled'` UNCHANGED (booking domain ownership preserved), `audit_log` has action `session.webhook.ended_on_cancelled`. Covers `/speckit-analyze` finding C2.

**Checkpoint**: After Phase 6, the teacher UX is loss-free across the manual/webhook race.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, deprecation of the old write path, cleanup.

- [ ] T025 [P] Once the webhook is live and verified for 14 days, REMOVE the page-visit-based `sessions.started_at` write in `trackSessionEvent()` (FR-011 — find via grep `trackSessionEvent` in `src/`); leave the `sessions.ended_at` manual write in place (User Story 4 still depends on it)
- [x] T026 [P] Update `docs/agents/` if any agent doc references the old behavior of `sessions.started_at` reflecting page-visit
- [x] T027 [P] Mark the 2x-cap migration `supabase/migrations/20260505084558_cap_actual_duration_at_2x_planned.sql` as candidate for removal in a follow-up cleanup PR (add a comment, do NOT remove in this feature) — SC-002 says no row should hit the cap anymore, but verification takes 30 days post-launch
- [x] T028 [P] Add a Findings Backlog entry under `Project Memory/furqan/Findings Backlog.md` marking F1 as resolved by this feature
- [ ] T029 Run `quickstart.md` smoke-test section end-to-end on production with a real Daily room; confirm the acceptance-criteria checklist all green

---

## Dependencies

```
Setup (Phase 1) ────────────┐
                            ├──> Foundational (Phase 2: migrations + types) ──┐
                            │                                                  │
                            └────────────────────────────────────────────────> │
                                                                               │
                            US1 (Phase 3) ─── core webhook handler ────────────┤
                                  │                                            │
                                  │                                            │
                            US2 (Phase 4) ─── burst-load verification ─────────┤
                                  │                                            │
                            US3 (Phase 5) ─── idempotency end-to-end ──────────┤
                                  │                                            │
                            US4 (Phase 6) ─── manual reconciliation ───────────┤
                                                                               │
                            Polish (Phase 7) ──────────────────────────────────┘
```

US1 is the MVP. US2/US3 are quality gates on US1; US4 is the UX guarantee.

US2, US3, US4 can be implemented in parallel after Phase 2 completes — they touch different files (load test, idempotency E2E, manual reconciliation) and don't share state with each other.

## Parallel execution per phase

**Phase 1**: T002 + T003 in parallel (different paths).
**Phase 2**: T004 + T005 sequential (migration ordering); T007 + T008 in parallel after T006.
**Phase 3**: T009 → T013 → T014 sequential (chain); T010 + T012 + T016 in parallel.
**Phase 4–6**: All three phases can run in parallel after Phase 3 lands; within each, the [P] tasks parallelize.
**Phase 7**: All T025–T028 in parallel; T029 last.

## Implementation strategy

- **MVP scope (Phase 1 + 2 + 3)**: ships a working webhook receiver that fixes the durations bug. ~9 tasks.
- **Production-ready scope (+ Phase 4 + 5 + 6)**: adds burst-load verification, idempotency E2E, manual UX. ~24 tasks.
- **Full scope (+ Phase 7)**: removes legacy write path, marks cap migration for retirement. ~29 tasks.

## Per-story task counts

| Story | Tasks | Parallelizable |
|---|---|---|
| Setup | T001–T003 (3) | 2 of 3 |
| Foundational | T004–T008 (5) | 2 of 5 |
| US1 | T009–T016 (8) | 3 of 8 |
| US2 | T017–T019.5 (4) | 2 of 4 |
| US3 | T020–T021 (3, incl. T020.5) | 2 of 3 |
| US4 | T022–T024.5 (4, incl. T024.5) | 3 of 4 |
| Polish | T025–T029 (5) | 4 of 5 |
| **Total** | **33** | **19** |

> US1 grew from 8 → 9 with the addition of T013.5 (FR-001 skew verification).

## Independent test criteria per story

- **US1**: Manual smoke test from `quickstart.md`. Real Daily room → real `sessions.ended_at` within 10s.
- **US2**: `tests/load/daily-webhook-burst.ts` P99 < 500ms over 200 events/60s.
- **US3**: `tests/e2e/daily-webhook-idempotency.spec.ts` — 1-row outcome on duplicate.
- **US4**: `tests/e2e/daily-webhook-reconciliation.spec.ts` — manual + webhook race produces Daily-canonical row.

## Format validation

All 33 tasks follow the required checklist format:
- `- [ ]` checkbox ✓
- Sequential TaskID (T001–T029 plus T013.5, T019.5, T020.5, T024.5 sub-numbered for /analyze-driven inserts) ✓
- `[P]` only on parallelizable tasks ✓
- `[US1]`/`[US2]`/`[US3]`/`[US4]` ONLY on Phase 3–6 tasks ✓
- No story label on Setup/Foundational/Polish ✓
- Exact file paths or commands in every description ✓

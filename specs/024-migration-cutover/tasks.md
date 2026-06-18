# Tasks: Data Migration + Big-Bang Cutover (Spec 024)

**Input**: `specs/024-migration-cutover/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Branch**: `024-migration-cutover` (cut after specs 018–023 merged & live)
**Prerequisites**: specs 018 (billing rails/grants), 019 (catalog/tiers), 020 (teacher assignment), 021 (attendance/payroll), 022 (single-sessions), 023 (reports/notifications) all **shipped and live**. Migration targets their structures.

> ⚠️ **Open items** (do NOT invent): cutover DATE/TIME, exact balance-conversion policy, rollback authority, and the captured-live-payments held-vs-refunded policy for a post-Stripe-flip rollback — see plan.md "Open Items" (#4 is a sub-decision of the rollback authority #3). Tasks reference them but require human-supplied values before the real cutover; the related seams (T008 balance, T026 post-live rollback) are fail-closed until supplied.

---

## Phase 1: Setup

- [ ] T001a Open a **draft PR** for branch `024-migration-cutover` and link a tracking issue (`Closes #N`) **before** the second implementation task (constitution branch-hygiene rule) — establishes VCS visibility early rather than committing only at the end (T039).
- [ ] T001 Verify branch cut after 018–023 merged; confirm migration targets exist: `SELECT to_regclass('public.subscriptions'), to_regclass('public.subscription_plans'), to_regclass('public.subscription_teacher_assignments'), to_regclass('public.student_progress'), to_regclass('public.student_credits'), to_regclass('public.student_packages')`
- [ ] T002 Confirm `student_progress_ayah_range_guard` is present and enabled: `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%ayah_range_guard%'`
- [ ] T003 Prepare the **rehearsal environment**: provision a production-copy DB per data-handling rules (NFR-004 — never insecure locations, credentials never inlined; use `op run`/env). Confirm `migration repair` / `migration up` tooling available against the copy.

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass; rehearsal copy reachable; guard enabled.

---

## Phase 2: Foundational — Ops tables + mapping rules + reconciliation generators

**⚠️ CRITICAL**: All user-story work blocked until T005 (`npm run db:types`) completes.

- [ ] T004 Create `supabase/migrations/20260620000000_migration_ops_tables.sql` (timestamped after `20260428000000_remote_baseline.sql`):
  - CREATE TYPE `migration_run_status AS ENUM ('running','completed','rolled_back','failed')`
  - CREATE TABLE `migration_runs (id uuid PK DEFAULT gen_random_uuid(), run_id text UNIQUE NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, status migration_run_status NOT NULL DEFAULT 'running', phase text NOT NULL, notes text)`
  - CREATE TABLE `migration_entity_markers (run_id text NOT NULL REFERENCES migration_runs(run_id), entity_kind text NOT NULL, entity_id uuid NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (run_id, entity_kind, entity_id))`
  - CREATE TABLE `manual_review_bucket (id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id), legacy_arrangement jsonb NOT NULL, reason text NOT NULL, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`
  - RLS ON for all three: admin-only SELECT; `service_role` INSERT/UPDATE; `manual_review_bucket` admin UPDATE `resolved` only; no `anon`/`authenticated`
  - `BEFORE UPDATE OF (run_id, started_at)` on migration_runs; `BEFORE UPDATE OF (user_id, legacy_arrangement)` on manual_review_bucket
- [ ] T005 `supabase migration up` (on rehearsal copy) → `npm run db:types` → commit regenerated `src/types/database.ts`
- [ ] T006 [P] Create `src/lib/domains/migration/ledger.ts`: `startRun(runId, phase)`, `markProcessed(runId, kind, entityId)`, `isProcessed(...)`, `setStatus(runId, status)` via service-role client
- [ ] T007 [P] Create `scripts/migration/mapping/user-to-tier.ts`: documented deterministic user→tier rule (individual vs group, session count/duration → closest catalog tier from spec 019); preserve teacher linkage into `subscription_teacher_assignments`; no clean equivalent ⇒ `manual_review_bucket` row. **Reads policy, no hardcoded tier guesses.**
- [ ] T008 [P] Create `scripts/migration/mapping/balance-to-entitlement.ts`: deterministic balance→entitlement conversion per the documented policy ([NEEDS CLARIFICATION] — stub the policy seam, fail-closed until supplied); emit per-student before/after ledger entry; zero balance ⇒ no entitlement
- [ ] T009 Create `src/lib/domains/migration/reconciliation.ts`: three report generators — `progressReport()` (per-student memorized-ayat total unchanged), `tierMappingReport()` (every user placed or flagged, 0 silent drops), `balanceReport()` (SUM legacy = SUM converted, itemized)

**Checkpoint**: `npm run sb:advisors` clean for the 3 new tables; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Hifz progress superset-merge (P1)

**Goal**: Every student's memorized-ayat total survives unchanged; ranges superset-merged through the guard; murajaah/SM-2 carried forward.

**Independent Test**: Quickstart Scenario 1 on the rehearsal copy.

- [ ] T010 [US1] Create `src/lib/domains/migration/progress-merge.ts`: `mergeStudentProgress(studentId, runId)` — compute additive superset of legacy `surah:ayah` ranges; write through `student_progress_ayah_range_guard` (NEVER disabled/bypassed); preserve exact `surah:ayah` byte-for-byte; never narrow/widen/reset/overstate; unmergeable conflict ⇒ `manual_review_bucket`; mark processed in ledger
- [ ] T011 [US1] Carry forward murajaah/SM-2 scheduler state (intervals, due dates, ease factors) unchanged within `mergeStudentProgress`
- [ ] T012 [US1] Wire `progressReport()` into the run; assert per student total memorized ayat unchanged (SC-001)
- [ ] T013 [US1] Unit test `src/lib/domains/migration/progress-merge.test.ts`: superset-merge additive (no narrow/widen); guard never bypassed; murajaah/SM-2 unchanged; overlapping legacy ranges merge to superset; conflict ⇒ manual_review_bucket

**Checkpoint**: progress reconciliation report = 100% students unchanged; guard fired 0 bypasses.

---

## Phase 4: User Story 2 — User→tier placement + manual-review (P1)

**Goal**: Every active user placed on an equivalent tier or routed to manual-review; 0 silent drops; teacher linkage preserved.

**Independent Test**: Quickstart Scenario 2 on the rehearsal copy.

- [ ] T014 [US2] Wire `user-to-tier.ts` (T007) into the run via `run-migration`; one placement per user; mark processed
- [ ] T015 [US2] Preserve student↔teacher linkage into `subscription_teacher_assignments` where a legacy linkage exists (FR-007)
- [ ] T016 [US2] Wire `tierMappingReport()`; assert every user placed-or-flagged, 0 silent drops (SC-002)
- [ ] T017 [US2] Unit test `scripts/migration/mapping/user-to-tier.test.ts`: clean-equivalent placed; no-equivalent ⇒ manual_review_bucket; teacher linkage preserved; 0 silent drops

**Checkpoint**: tier-mapping report = 100% placed-or-flagged; manual-review bucket populated for ambiguous users only.

---

## Phase 5: User Story 3 — Balance conversion + ledger (P1)

**Goal**: Legacy balance total = converted entitlement total; 0 silent forfeiture; 0 spurious entitlement.

**Independent Test**: Quickstart Scenario 3 on the rehearsal copy.

> ⛔ **BLOCKER — do NOT implement T018–T020 until the balance-conversion policy is supplied by a human owner.** This is an engineering gap, not an operational sign-off: the legacy-balance → new-entitlement rule is a deterministic mapping the migration code must encode (money-correctness, irreversible at cutover). The T008 seam is fail-closed and `balance-to-entitlement.ts` MUST throw until the policy is defined. Resolving the [NEEDS CLARIFICATION] in plan.md "Open Items" is a hard precondition for this phase.

- [ ] T018 [US3] Wire `balance-to-entitlement.ts` (T008) into the run; per-student before/after ledger; zero-balance ⇒ no entitlement; mark processed
- [ ] T019 [US3] Wire `balanceReport()`; assert `SUM(legacy outstanding) = SUM(converted)` within policy, itemized (SC-003)
- [ ] T020 [US3] Unit test `scripts/migration/mapping/balance-to-entitlement.test.ts`: non-zero converts per policy; zero ⇒ no entitlement; reconciliation sum holds; mid-cycle remainder itemized; **policy-unset ⇒ fail-closed**

**Checkpoint**: balance ledger reconciles; 0 unexplained forfeitures.

---

## Phase 6: User Story 4 — Cutover runbook + rollback (P1)

**Goal**: Rehearsed, reversible, backed-up cutover from a runbook; schema-history reconciled; Stripe flips keys-only after verification.

**Independent Test**: Quickstart Scenario 5 (injected-failure rollback) on the rehearsal copy.

- [ ] T021 [US4] Create `scripts/migration/reconcile-schema-history.ts`: derive the pre-baseline version set from prod `schema_migrations` at run time (the documented "~103" is an approximation — query the actual versions, do not hardcode the count); for each pre-baseline version run `migration repair --status reverted <version>`, then apply post-baseline migrations; **NEVER** `db push` the baseline; on failure halt → abort (FR-015)
- [ ] T022 [US4] Create `scripts/migration/run-migration.ts`: `run_migration(dry_run, resume_from_run_id?)` orchestrator — invokes progress-merge → user-to-tier → balance conversion → bookings resolution → reconciliation; idempotent + atomic-or-resumable via ledger; service-role/operator-only
- [ ] T023 [US4] Create `docs/runbooks/024-cutover-runbook.md`: ordered steps (freeze → restore-verified backup → reconcile schema history → migrate → verify gates → flip Stripe keys-only → retire legacy paths → unfreeze → **post-cutover reconciliation/verification**) + rollback plan (restore-from-verified-backup) + explicit trigger criteria + captured-live-payments handling if rollback after live flip (FR-020/021). Define **restore-verified** as a concrete pass/fail check (FR-014): restore the backup onto a scratch target and assert **row-count parity on every touched table AND content-checksum parity** (per-table ordered-row hash or `pg_dump` digest) vs the source snapshot; any mismatch ⇒ FAIL ⇒ abort before the destructive step. Add a final **post-unfreeze verification** step (FR-023/SC-010): re-run the 3 reconciliation reports against the live post-cutover system + a legacy-paths-retired smoke check; any FAIL ⇒ escalate to the rollback authority. Reference the **4 open items** (cutover timestamp, balance policy, rollback authority, captured-live-payments held/refunded policy — #4 fail-closed until supplied)
- [ ] T024 [P] [US4] Create `src/app/api/admin/migration/reconciliation/route.ts`: GET, admin auth, returns 3 reports
- [ ] T025 [P] [US4] Create `src/app/api/admin/migration/manual-review/route.ts`: GET, admin auth, paginated `manual_review_bucket`
- [ ] T026 [US4] Create `src/app/api/admin/migration/rollback/route.ts`: POST, **restricted rollback role** ([NEEDS CLARIFICATION] authority), zod `{run_id, reason, confirm}`, triggers restore procedure, sets `migration_runs.status='rolled_back'`, idempotent. **Fail-closed on the captured-live-payments policy ([NEEDS CLARIFICATION] #4)**: if the run is past the Stripe live flip, the handler MUST NOT complete a post-live rollback with an invented held/refunded rule — it surfaces the undecided policy (e.g. 409/blocked with the policy gap) until a human-supplied held-vs-refunded rule is configured (FR-021). Data-only rollbacks before the flip are unaffected.
- [ ] T027 [US4] Document Stripe flip as keys/config-only, **after** all 3 reports PASS; FAIL ⇒ leave Stripe in test mode (FR-018); 0 code changes (SC-007)
- [ ] T028 [US4] Unit test `scripts/migration/run-migration.test.ts`: dry_run emits reports without finalizing; verification FAIL blocks Stripe flip + triggers rollback path; rollback restores ledger status

**Checkpoint**: schema reconcile produces clean deploy (0 baseline force-pushes); runbook + rollback documented with criteria; verification gates wired before the flip; restore-verified defined as row-count+checksum parity; post-unfreeze verification step present; post-live-flip rollback fail-closed on the captured-payments policy.

---

## Phase 7: User Story 5 — In-flight legacy bookings at cutover (P2)

**Goal**: Future-dated/in-progress bookings spanning the cutover instant are honored or accounted, never silently dropped.

**Independent Test**: Rehearsal copy seeded with future-dated + in-progress bookings spanning the cutover instant.

- [ ] T029 [US5] Add `resolveInFlightBookings(runId, cutoverInstant)` to `run-migration.ts`: classify bookings against the unambiguous absolute cutover timestamp; carry forward / honor as one-off / refund-or-credit per policy; in-progress instant session debit/credit reconciled exactly once; none silently deleted (FR-008)
- [ ] T030 [US5] Unit test: future-dated confirmed booking carried/honored; in-progress instant session reconciled once; 0 silent deletes; timezone classification deterministic (uses absolute cutover instant)

**Checkpoint**: every spanning booking carried/honored/refunded; 0 orphaned bookings.

---

## Phase 8: Polish + production-copy rehearsal

- [ ] T031 [P] `npx tsc --noEmit` — fix all type errors
- [ ] T032 [P] `npm run lint` — fix all lint issues
- [ ] T033 `npm run test:unit` — all existing + new tests pass (NFR-005)
- [ ] T034 `npm run sb:advisors` — zero new advisories for the 3 new tables
- [ ] T035 Idempotent re-run test: run migration twice on the rehearsal copy → 0 double-grants / 0 duplicated progress / 0 double-converted balances (SC-004)
- [ ] T036 Partial-migration / rollback test: inject a mid-run failure → assert atomic-or-resumable (safe resume OR restore-from-backup, never half-migrated); rollback restores exact pre-cutover state (SC-005/008)
- [ ] T037 RLS audit: confirm RLS enabled + policies intact on **every** touched table during & after migration (NFR-002) — `migration_runs`, `manual_review_bucket`, and all migration targets
- [ ] T038 **Production-copy rehearsal**: run the full runbook end-to-end on the production copy including a deliberately injected failure that correctly triggers rollback (FR-012, SC-008); exercise the **restore-verified** check for real (row-count + checksum parity vs source; mismatch ⇒ abort) (FR-014/SC-005) and the **post-unfreeze verification** pass (FR-023/SC-010); credentials never inlined, copy handled per data rules
- [ ] T040 Post-cutover verification test (FR-023/SC-010): after a rehearsal unfreeze, run the post-unfreeze reconciliation pass (3 reports against the live post-cutover state + legacy-paths-retired smoke check); assert all PASS, and assert that an injected post-unfreeze FAIL escalates to the rollback authority rather than silently passing. Distinct from the pre-flip gate test (T028).
- [ ] T039 Commit all spec artifacts on the **`024-migration-cutover`** branch (the same working/PR branch opened in T001a) and push to update that PR. (Note: an earlier draft targeted a `docs/pivot-specs-019-024` path; the canonical target is the `024-migration-cutover` branch from T001a — keep T001a and T039 on the same branch.)

---

## Dependencies

- **Blocks on**: specs **018–023 shipped and live** — the migration writes into their structures (subscriptions/plans/grants, tier catalog, teacher assignments).
- **Phase 2** (ops tables + mapping + reconciliation generators) → blocks all user stories.
- **US1** (T010–T013): hifz superset-merge; independent of US2–US3; highest-risk P1.
- **US2** (T014–T017): user→tier; depends on Phase 2 mapping rule; independent of US1/US3.
- **US3** (T018–T020): balance conversion; depends on Phase 2; gated by the [NEEDS CLARIFICATION] policy (fail-closed until supplied).
- **US4** (T021–T028): runbook + rollback; depends on US1–US3 (reconciliation gates aggregate their reports); schema reconcile (T021) must precede any data migration.
- **US5** (T029–T030): in-flight bookings; depends on US4 (cutover instant + run orchestrator); P2.
- **Phase 8**: all stories complete; production-copy rehearsal is the final gate.

## Parallel Opportunities

- T006 + T007 + T008 within Phase 2 (distinct files)
- T024 + T025 within US4 (distinct admin routes)
- T031 + T032 in Phase 8

## MVP Scope

P1 stories US1–US4 are the cutover MVP and must all pass on the production-copy rehearsal before the
real event. US5 (P2, in-flight bookings) is required for a clean cutover but is a bounded edge
population. Deliver in order: Phase 1 → 2 → 3 (US1) → 4 (US2) → 5 (US3) → 6 (US4) → 7 (US5) → 8.

**The real cutover does NOT proceed** until: all 5 quickstart scenarios pass on the production copy;
`tsc`/`lint`/`test:unit` green; `sb:advisors` clean; and the 4 open items (cutover timestamp,
balance-conversion policy, rollback authority, and the captured-live-payments held/refunded policy —
#4 a sub-decision of the rollback authority) are supplied by a human.

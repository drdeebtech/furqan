# Feature Specification: Data Migration + Big-Bang Cutover

**Feature Branch**: `024-migration-cutover`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٧ (data migration + cutover) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Migrate all existing users, balances, and especially hifz (memorization) progress from the legacy per-session-booking + one-time-package system into the new subscription/courses model, then execute a single fixed-date big-bang cutover that stops the old system and starts the new one for everyone at once — with a short freeze, a verified backup, a migration script tested on a production copy, a documented rollback plan, and the production schema-history reconciliation that a clean deploy requires.

---

## Context & Scope

The platform currently bills per session via one-time packages and free-form booking. Specs 018–023 built the new world (subscription billing rails, catalog/tiers, teacher assignment + cohorts, attendance/payroll, onboarding/single-sessions, reports/notifications) **alongside** the still-live legacy system — by design, spec 018 deliberately left the old one-time-package and per-session-booking paths running during the build.

This spec is the **switchover event**. It does two things and nothing else:

1. **Migrate existing data** — map every existing user to an equivalent new tier/product, convert legacy balances into the new entitlement model, and **migrate hifz progress** (the highest-value, highest-risk data) into the new structures without ever losing, resetting, or overstating a learner's memorization (AGENTS.md §4: progress is **merged, never overwritten**).
2. **Cut over** — on a single fixed date, freeze writes briefly, take a verified backup, run the tested migration, retire the legacy booking/package paths, flip Stripe from test mode to live (keys only, no code change), and stand ready to roll back if defined criteria trip.

The strategy is **big-bang** (per the plan's Implementation decisions): the old system stops and the new system starts for **everyone at once**. This concentrates risk into one window, which is exactly why a freeze, backup, production-copy rehearsal, and rollback plan are mandatory rather than optional.

**In scope:** the migration mapping rules (user→tier, balance→entitlement, hifz progress→new progress structures); the cutover runbook (freeze → backup → reconcile prod schema history → migrate → verify → flip Stripe live → retire legacy paths → unfreeze); rehearsal on a production copy; the rollback plan and its trigger criteria; post-cutover reconciliation/verification.

**Explicitly out of scope (each prior phase owns its own feature spec):**
- Subscription billing rails, webhooks, idempotent grants → **spec 018** (م١).
- Pricing catalog, the tiers, single-active-hifz rule, family discounts, proration → **spec 019** (م٢).
- Teacher assignment, availability, cohorts/halaqas → **spec 020** (م٣).
- Attendance, excuses, payroll → **spec 021** (م٤).
- Assessment / instant / specialized single sessions → **spec 022** (م٥).
- Reports, gamification, notifications → **spec 023** (م٦).
- This spec only **moves existing data** and **executes the cutover event**; it does not design or change any of those features.

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: a big-bang cutover is a one-shot, high-blast-radius operation — it demands a verified backup, a rehearsal on a real production copy, an explicit rollback path, and resolution of the known production `schema_migrations` reconciliation hazard (the real deploy blocker). Migrations are timestamped after the remote baseline; the baseline is never `db push`ed; RLS is preserved on every touched table; `sb:advisors` clean.
- 📖 **Quran teacher**: hifz progress is sacred data. Exact `surah:ayah` must survive byte-for-byte; the `student_progress_ayah_range_guard` is **never bypassed**; progress is **merged, never overwritten, reset, or overstated**; murajaah scheduler state is preserved so no learner restarts review they already completed.
- 🎓 **Platform expert**: on cutover morning a learner must wake up inside an equivalent product with their memorization intact and their remaining value honored — no one is dropped mid-program, no one loses standing, and the freeze window is short and communicated.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Existing learner's hifz progress survives the cutover intact (Priority: P1)

An active student who has memorized a range of ayat in the legacy system logs in after cutover and finds their full memorization history, exact surah:ayah progress, and review schedule intact in the new model — nothing lost, nothing reset, nothing inflated.

**Why this priority**: Hifz progress is the platform's irreplaceable, highest-value data and the one thing a model is forbidden to fabricate (AGENTS.md §2). Corrupting or resetting it is catastrophic and unrecoverable for the learner. This is the migration's reason to exist.

**Independent Test**: On a production copy, snapshot every student's progress before migration; run the migration; assert that for every student, every `surah:ayah` range present before is present after (merged, never narrowed or widened), the ayah-range guard never fired a bypass, and murajaah/SM-2 scheduler state (intervals, due dates, ease) carries forward unchanged.

**Acceptance Scenarios**:

1. **Given** a student with recorded `student_progress` ranges, **When** the migration runs, **Then** every pre-migration `surah:ayah` range is preserved exactly and any merge is additive — never overwriting, narrowing, or overstating memorized ayat.
2. **Given** a student with active murajaah/SM-2 review state, **When** the migration runs, **Then** review intervals, due dates, and ease factors carry forward so no completed review is repeated and no due review is dropped.
3. **Given** any progress row, **When** it is written into the new structures, **Then** the `student_progress_ayah_range_guard` validates it normally and is **never** disabled or bypassed.
4. **Given** the full student set, **When** migration completes, **Then** a reconciliation report shows zero students whose total memorized ayat decreased or increased versus their legacy record.

---

### User Story 2 - Existing user is placed on an equivalent new tier/product (Priority: P1)

Every existing student is mapped to the closest-equivalent new subscription tier or product so that, post-cutover, they are enrolled in a meaningful product rather than stranded with no plan.

**Why this priority**: A big-bang cutover leaves no legacy path to fall back to — an unmapped user has no product at all the morning after. Equal P1 with progress integrity.

**Independent Test**: On a production copy, run the migration and assert every active user has exactly one resulting placement (an equivalent tier/product or an explicitly flagged manual-review case), with a deterministic, documented mapping rule and zero silent drops.

**Acceptance Scenarios**:

1. **Given** an existing student on a legacy package/booking arrangement, **When** the migration runs, **Then** they are mapped to a documented equivalent new tier/product (individual vs group, session count/duration matched as closely as the catalog allows).
2. **Given** a student whose legacy arrangement has no clean equivalent, **When** the migration runs, **Then** they are routed to an explicit **manual-review** bucket (never silently dropped, never guessed onto a wrong tier).
3. **Given** the teacher relationship in the legacy data, **When** mapping an individual-package student, **Then** their existing teacher linkage is preserved into the new fixed-teacher assignment where one exists.

---

### User Story 3 - Existing balances are converted fairly into new entitlements (Priority: P1)

A student carrying legacy package credits / `student_credits` at cutover has that remaining value honored under the new model rather than forfeited.

**Why this priority**: Silently voiding paid-for, unused balance is both a financial-integrity failure and a trust/churn disaster on day one. P1 because it touches money and fairness simultaneously.

**Independent Test**: On a production copy, sum every student's outstanding legacy balance before migration; run the migration; assert each student's converted entitlement equals their pre-migration balance under the documented conversion policy, with a per-student before/after ledger and zero unexplained loss.

**Acceptance Scenarios**:

1. **Given** a student with remaining legacy `student_packages`/`student_credits` balance, **When** the migration runs, **Then** that remaining value is converted into a documented new-model entitlement (e.g., a grant or credit) per the conversion policy with no silent forfeiture.
2. **Given** a student with zero remaining balance, **When** the migration runs, **Then** no spurious entitlement is created.
3. **Given** the full balance set, **When** migration completes, **Then** a reconciliation ledger reconciles total legacy balance to total converted entitlement within the documented policy, with every adjustment itemized.

---

### User Story 4 - The cutover runs as a rehearsed, reversible, backed-up event (Priority: P1)

The operations team executes the cutover from a runbook: short write-freeze, verified backup, prod schema-history reconciliation, the production-copy-tested migration, verification gates, the Stripe live-key flip, retirement of legacy paths, then unfreeze — with the ability to roll back cleanly if a trigger criterion is hit.

**Why this priority**: Big-bang means there is no incremental safety net; the safety must come from the procedure itself. Without a verified backup and a rehearsed rollback, an undetected migration defect is unrecoverable. P1.

**Independent Test**: Execute the entire runbook against a production copy (including a deliberately injected failure) and confirm: the backup restores cleanly, the rollback returns the system to the pre-cutover state, and the rollback decision criteria are unambiguous.

**Acceptance Scenarios**:

1. **Given** the cutover window opens, **When** the freeze is applied, **Then** new financial/booking writes are blocked for the duration so the migration runs against a stable snapshot, and the freeze window is short and communicated in advance.
2. **Given** the freeze is in place, **When** the backup step runs, **Then** a full, **restore-verified** backup of production exists before any destructive migration step.
3. **Given** the known production `schema_migrations` reconciliation hazard (~103 pre-baseline versions listed in prod), **When** the deploy step runs, **Then** the history is reconciled (mark pre-baseline versions reverted, then apply post-baseline migrations) so the deploy is clean — this is treated as the real deploy blocker, not application code.
4. **Given** the migration completes, **When** verification gates run, **Then** progress-integrity, tier-mapping, and balance-conversion reconciliation reports all pass before the cutover is declared successful.
5. **Given** a verification gate fails or a rollback trigger criterion is met, **When** the operator invokes rollback, **Then** the system is restored to the verified backup / pre-cutover state and the legacy system resumes.
6. **Given** verification passes, **When** the cutover is finalized, **Then** Stripe is switched from test to live by **configuration/keys only** (no code change), the legacy one-time-package and per-session-booking paths are retired, and the freeze is lifted.

---

### User Story 5 - In-flight legacy bookings at cutover are resolved, not orphaned (Priority: P2)

Sessions already booked (or instant sessions in progress) at the cutover instant are honored or cleanly accounted for, not silently dropped by the legacy-path retirement.

**Why this priority**: A learner with a confirmed lesson tomorrow must not lose it because the booking system was retired tonight. Important, but a bounded edge population versus the universal P1 concerns.

**Independent Test**: On a production copy seeded with future-dated and in-progress bookings spanning the cutover instant, run the migration and assert each is either carried into the new schedule, honored as a one-off, or refunded/credited per policy — none silently deleted.

**Acceptance Scenarios**:

1. **Given** a confirmed legacy booking dated after cutover, **When** the migration runs, **Then** it is carried into the new scheduling model or explicitly honored, never silently dropped.
2. **Given** an instant session in progress at the freeze instant, **When** the freeze applies, **Then** it is allowed to complete or is cleanly accounted for, with its debit/credit reconciled exactly once.

---

### Edge Cases

- **Partial / interrupted migration**: the migration aborts midway (error, timeout, crash). The run MUST be atomic-or-resumable so the database is never left half-migrated; a partial run MUST be safely rolled back to the verified backup rather than left in a mixed state.
- **Hifz progress merge conflict**: a learner has overlapping/contradictory progress across legacy tables. Resolution MUST favor the **superset** of memorized ayat (merge, never narrow) and MUST never overstate beyond what any source records; conflicts that cannot be safely merged are flagged for human review, never guessed.
- **Mid-cycle / mid-month balance at cutover**: a student is partway through a legacy package or just paid. Conversion MUST follow the documented balance policy deterministically; ambiguous remainders are itemized in the reconciliation ledger, not silently absorbed.
- **In-flight booking spanning the freeze instant**: covered by Story 5 — honored or accounted, never orphaned.
- **User with no clean tier equivalent**: routed to the manual-review bucket (Story 2), never auto-placed onto a guessed tier.
- **Duplicate / re-run of the migration script**: re-running MUST be idempotent — no double-granted entitlements, no duplicated progress, no double-charged or double-credited balances.
- **Stripe key flip ordering**: live keys MUST be flipped only **after** data-migration verification passes; flipping early could charge real cards against unverified state. A failed verification MUST leave Stripe in test mode.
- **Schema-history reconciliation failure**: if `migration repair`/post-baseline apply fails, the cutover MUST halt before any data migration and fall back to the freeze-release/abort path — never force-push the baseline.
- **Rollback after Stripe is live**: if a defect is found after live charges have occurred, the rollback plan MUST define how already-captured live payments are handled (held/refunded) — data rollback alone is insufficient once real money moved.
- **Timezone of the cutover instant**: the freeze/cutover instant MUST be an unambiguous absolute timestamp so "future-dated" booking classification is deterministic across regions.

---

## Requirements *(mandatory)*

### Functional Requirements — Data Migration

- **FR-001**: The system MUST map every existing active user to an equivalent new subscription tier/product using a **documented, deterministic** mapping rule (individual vs group, session count/duration matched as closely as the catalog allows); no user may be left without a placement.
- **FR-002**: Any user whose legacy arrangement has no clean catalog equivalent MUST be routed to an explicit **manual-review** bucket and surfaced to admins — never silently dropped and never auto-placed on a guessed tier.
- **FR-003**: The migration MUST preserve every existing student's hifz progress such that, for each student, the set of memorized `surah:ayah` ranges after migration is the **exact superset-merge** of their legacy ranges — **never overwritten, narrowed, reset, or overstated** (AGENTS.md §4).
- **FR-004**: All migrated progress writes MUST pass through (and never bypass or disable) the `student_progress_ayah_range_guard`; exact `surah:ayah` values and any tashkeel/structural data MUST be preserved byte-for-byte.
- **FR-005**: The migration MUST preserve murajaah / SM-2 review scheduler state (intervals, due dates, ease factors) so that no completed review is repeated and no due review is lost.
- **FR-006**: The migration MUST convert each student's remaining legacy balance (`student_packages` / `student_credits`) into a documented new-model entitlement per the **balance-conversion policy**, with no silent forfeiture and no spurious entitlement for zero-balance users.
- **FR-007**: The migration MUST preserve the existing student↔teacher relationship into the new fixed-teacher assignment wherever a legacy linkage exists.
- **FR-008**: The migration MUST resolve in-flight legacy bookings spanning the cutover instant (future-dated confirmed bookings, in-progress instant sessions) by carrying them forward, honoring them as one-offs, or refunding/crediting per policy — none silently deleted.
- **FR-009**: The migration script MUST be **idempotent**: re-running it MUST NOT double-grant entitlements, duplicate progress rows, or double-convert balances.
- **FR-010**: The migration MUST be **atomic-or-resumable**: an interrupted run MUST NOT leave the database in a half-migrated state; recovery is either safe resume or restore-from-backup.
- **FR-011**: The migration MUST emit per-domain **reconciliation reports** — progress integrity (no student's memorized-ayat total changed), tier mapping (every user placed or flagged), balance conversion (legacy total reconciles to converted total) — that must all pass before cutover is declared successful.

### Functional Requirements — Cutover Event

- **FR-012**: The migration script MUST be executed and verified on a **copy of production data** before any production run; passing the production-copy rehearsal (including reconciliation reports) is a precondition for the real cutover.
- **FR-013**: A **short, pre-announced write-freeze** MUST be applied over financial/booking writes for the cutover window so the migration operates on a stable snapshot.
- **FR-014**: A full, **restore-verified backup** of production MUST be taken (and its restorability confirmed) **before** any destructive migration step.
- **FR-015**: The cutover MUST reconcile the production `schema_migrations` history (the documented ~103 pre-baseline versions) by marking pre-baseline versions reverted and then applying post-baseline timestamped migrations, producing a clean deploy; the remote baseline MUST NEVER be `db push`ed and the baseline-after ordering MUST be preserved.
- **FR-016**: All new migrations MUST be timestamped to sort **after** `20260428000000_remote_baseline.sql`; RLS MUST remain enabled with policies intact on every table the migration touches; `sb:advisors` MUST be clean for the changes.
- **FR-017**: The legacy one-time-package and per-session-booking write paths (left running by spec 018 during the build) MUST be retired at cutover so the new subscription/courses system is the sole active system for everyone.
- **FR-018**: Stripe MUST be switched from test mode to live by **configuration/keys only, with no code change**, and **only after** data-migration verification passes; a failed verification MUST leave Stripe in test mode.
- **FR-019**: Payment methods at go-live MUST be **Stripe only, USD only** (per plan decision #17); no other gateway or currency is enabled at cutover.
- **FR-020**: A **documented rollback plan** MUST exist with **explicit trigger criteria** (e.g., a reconciliation gate fails, data corruption detected, migration aborts), a restore-from-verified-backup procedure, and a defined owner who is authorized to invoke it.
- **FR-021**: If rollback is invoked, the system MUST be returned to the verified pre-cutover state and the legacy system MUST resume; the plan MUST also define handling of any **live payments already captured** if rollback occurs after the Stripe live flip (held/refunded).
- **FR-022**: The cutover instant MUST be expressed as an **unambiguous absolute timestamp** so future-dated booking classification is deterministic across timezones.

### Non-Functional / Security Requirements

- **NFR-001**: No hifz progress migration step may run without the ayah-range guard active; a guard-disabling step is forbidden under any circumstance.
- **NFR-002**: RLS MUST remain enabled on every table during and after migration; no migration step may leave a table with RLS off or policies dropped.
- **NFR-003**: Any migration with money/grant/progress logic MUST be verified locally in Postgres against a production copy before production execution, simulating the full sequence (map + convert + merge progress + idempotent re-run); `sb:advisors` MUST be clean.
- **NFR-004**: Production data MUST never be copied to insecure or shared locations; the production copy used for rehearsal MUST be handled per the project's data-handling rules and credentials never inlined into commands.
- **NFR-005**: The full check suite MUST pass: `tsc --noEmit`, `lint`, `test:unit`; migration logic (mapping, merge, conversion, idempotency, rollback) covered by tests including the partial-migration and re-run paths.

### Key Entities *(data involved)*

- **Legacy user/arrangement** (`profiles`, `bookings`, `packages`): the pre-cutover state mapped onto new tiers/products.
- **Legacy balance** (`student_packages`, `student_credits`): remaining paid value converted into new-model entitlements per the conversion policy.
- **Hifz progress** (`student_progress` and murajaah/SM-2 scheduler state): the sacred data merged forward, exact `surah:ayah` preserved, guarded by `student_progress_ayah_range_guard`.
- **New-model entitlement / placement** (subscription/plan/grant primitives from spec 018, tier catalog from spec 019): the migration's output target for each user.
- **Migration reconciliation report**: per-domain before/after ledgers (progress, tier mapping, balance) proving no loss/overstatement; the cutover-success gate.
- **Cutover runbook / rollback plan**: the ordered procedure and its trigger criteria, backup, and restore steps (operational artifact, not a table).
- **Production schema history** (`schema_migrations`): the prod-only reconciliation surface (~103 pre-baseline versions) that gates a clean deploy.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration on the production copy, **100%** of students have their memorized-ayat total unchanged (neither decreased nor increased) versus their legacy record — verified by the progress reconciliation report.
- **SC-002**: **100%** of active users are placed on an equivalent tier/product or are in the explicit manual-review bucket; **0** silent drops.
- **SC-003**: Total converted entitlement reconciles to total legacy outstanding balance within the documented policy, with **0** unexplained forfeitures — verified by the balance ledger.
- **SC-004**: Re-running the migration script produces **0** duplicate entitlements, **0** duplicated progress rows, and **0** double-converted balances (idempotency proven).
- **SC-005**: A restore-verified backup exists before the destructive migration step, and a rehearsal rollback returns the production copy to its exact pre-cutover state — **100%** restorable.
- **SC-006**: The production schema-history reconciliation yields a clean deploy with the baseline never `db push`ed and `sb:advisors` clean — **0** baseline force-pushes.
- **SC-007**: Stripe goes live **only after** verification passes and **only via key/config change** — **0** code changes required for the test→live transition.
- **SC-008**: The end-to-end runbook (freeze → backup → reconcile → migrate → verify → flip → retire → unfreeze) completes on the production copy, including a deliberately injected failure that correctly triggers rollback.
- **SC-009**: The write-freeze window is bounded and pre-communicated; **0** learners lose access to their account, progress, or honored balance the morning after cutover.

---

## Assumptions

- **Prior phases are complete and live in test mode**: specs 018–023 have shipped the new subscription/courses system, which has been running alongside the legacy system during the build; this spec only moves data and flips the switch.
- **Reuses spec 018/019 primitives as migration targets**: subscription/plan/grant tables (018) and the tier catalog (019) already exist; the migration writes into them rather than defining them.
- **Hifz data lives in `student_progress` + murajaah/SM-2 scheduler state**, guarded by `student_progress_ayah_range_guard`; the canonical structural reference (`src/lib/quran/`) is unchanged and authoritative for `surah:ayah` validity.
- **Legacy balances live in `student_packages` / `student_credits`**, and legacy arrangements in `profiles` / `bookings` / `packages`.
- **Migration topology**: new migrations are timestamped to sort after `20260428000000_remote_baseline.sql` (the remote pg_dump = prod HEAD); the baseline is **never** `db push`ed; old applied migrations live in `supabase/migrations_archive/`.
- **The prod `schema_migrations` reconciliation (~103 pre-baseline versions → `migration repair --status reverted` then `db push`) is the real deploy blocker** and is owned by this cutover, not by application code.
- **Balance-conversion math and any adjustable financial values** are data/policy, not hardcoded; the policy is documented and reconcilable.
- **The production copy** for rehearsal is a faithful, recent snapshot handled per data-handling rules; credentials are never inlined into commands.
- **[NEEDS CLARIFICATION: the fixed cutover DATE/TIME is not yet set — it must be chosen, expressed as an unambiguous absolute timestamp, and pre-announced before scheduling the freeze.]**
- **[NEEDS CLARIFICATION: the exact legacy-balance→new-entitlement conversion policy (how remaining package credits/`student_credits` map to grants/credits, and how mid-cycle remainders are valued) is not yet finalized — a deterministic, reconcilable rule is required.]**
- **[NEEDS CLARIFICATION: the rollback decision authority (which named role is authorized to invoke rollback, and the go/no-go sign-off owner for the verification gates) is not yet assigned.]**

## Dependencies

- **Blocks on**: specs 018 (billing rails), 019 (catalog/tiers), 020–023 (scheduling, attendance/payroll, single-sessions, reports/notifications) all being shipped and live, since the migration targets their structures.
- **Existing tables**: `profiles`, `bookings`, `packages`, `student_packages`, `student_credits`, `student_progress` (+ murajaah/SM-2 scheduler state), plus the new subscription/plan/grant/tier tables from specs 018–019.
- **Existing guards/conventions**: `student_progress_ayah_range_guard` (never bypassed), RLS on every table, `( select auth.uid() )` initplan policies, the `BEFORE UPDATE OF` financial-column guard, `platform_settings` for adjustable values.
- **Stripe**: a live-mode account and keys ready to swap in (test→live by configuration only); USD-only, Stripe-only at go-live.
- **Operational**: a verified production backup/restore capability, a production-copy environment for rehearsal, the `migration repair` / `db push` tooling, and a chosen, pre-announced cutover window.
- **Verification**: local Postgres rehearsal of the migration on a production copy; `sb:advisors` clean; `tsc --noEmit` + `lint` + `test:unit` green; reconciliation reports passing before the cutover is declared successful.

## Clarifications

### Session 2026-06-16 (analyze remediation)

- Q: The 3 [NEEDS CLARIFICATION] markers (cutover date/time, balance-conversion policy, rollback authority)? → A: INTENTIONALLY left open — owner/operator decisions, correctly fail-closed in tasks. Not defects.
- Q: 50k-scale freeze window? → A: add an explicit scale note bounding migration runtime + freeze duration at 50,000 students (constitution NON-NEGOTIABLE requires scale evaluation).
- Q: Branch hygiene? → A: add an early "open draft PR + link tracking issue (Closes #N)" task; current tasks.md commits VCS only at the end.
- Q: spec wording "...then db push" (reconciliation)? → A: reword to "then apply post-baseline migrations (never `db push` the baseline)" to remove the apparent contradiction with FR-015.

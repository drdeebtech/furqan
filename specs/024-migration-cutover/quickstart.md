# Quickstart: Data Migration + Big-Bang Cutover (Spec 024)

**Input**: `specs/024-migration-cutover/spec.md`
**Branch**: `024-migration-cutover` | **Date**: 2026-06-16

All scenarios run as a **rehearsal on a copy of production data** (FR-012, NFR-003/004) — never
against live prod, never with credentials inlined into commands, never copied to insecure locations.
Each scenario maps to a P1/P2 user story and its measurable success criterion.

---

## Scenario 1 — Hifz progress superset-merge preserved (US1, SC-001)

**Goal**: Every student's memorized-ayat total is unchanged after migration.

1. Snapshot every student's `student_progress` ranges + murajaah/SM-2 state before migration.
2. `run_migration(dry_run=true)`.
3. Assert: for every student, every pre-migration `surah:ayah` range is present after (additive superset-merge — never narrowed/widened/reset/overstated).
4. Assert: the ayah-range guard validated every write and **never** reported a bypass.
5. Assert: murajaah/SM-2 intervals, due dates, and ease factors carry forward unchanged.

**PASS**: progress reconciliation report shows 100% of students with an unchanged memorized-ayat total.

---

## Scenario 2 — Every active user placed or flagged, 0 silent drops (US2, SC-002)

**Goal**: No user wakes up the morning after with no product.

1. `run_migration(dry_run=true)` on the copy.
2. Assert: every active user has exactly **one** placement — an equivalent tier/product **or** a `manual_review_bucket` row.
3. Assert: existing student↔teacher linkages are preserved into `subscription_teacher_assignments`.
4. Assert: 0 users with no placement and no manual-review row (0 silent drops).

**PASS**: tier-mapping reconciliation report shows 100% placed-or-flagged, 0 silent drops.

---

## Scenario 3 — Balance conversion reconciles (US3, SC-003)

**Goal**: Legacy outstanding balance total = converted entitlement total.

1. Sum every student's outstanding legacy `student_packages` / `student_credits` balance before migration.
2. `run_migration(dry_run=true)`.
3. Assert: the balance-conversion policy is **[NEEDS CLARIFICATION #2]** (owner decision, not yet supplied) — the conversion seam is **fail-closed**: `run_migration` MUST refuse balance conversion until the policy is defined, so this scenario CANNOT pass until then. Once supplied: each non-zero-balance student has a converted entitlement per that policy; each zero-balance student has **no** spurious entitlement.
4. Assert (once the policy is supplied): `SUM(legacy outstanding) = SUM(converted entitlement)` per that policy; every adjustment itemized in the per-student ledger.

**PASS**: balance ledger reconciles with 0 unexplained forfeitures.

---

## Scenario 4 — Idempotent re-run ⇒ 0 duplicates (US1–US3, SC-004)

**Goal**: Running the script twice changes nothing the second time.

1. Run the migration once (records a `migration_runs` row + entity markers).
2. Run it again with the same data.
3. Assert: 0 double-granted entitlements, 0 duplicated progress rows, 0 double-converted balances.

**PASS**: second run is a verifiable no-op across all three domains.

---

## Scenario 5 — Injected-failure rollback restores exact pre-cutover state (US4, SC-005/008)

**Goal**: An undetected defect is fully recoverable.

1. Take the restore-verified backup; capture a full pre-cutover snapshot.
2. Begin the runbook, then **inject a deliberate failure** mid-migration (e.g. force a reconciliation FAIL or abort the run).
3. Assert: the rollback trigger criteria fire unambiguously; Stripe **remains in test mode**.
4. Invoke `POST /api/admin/migration/rollback` (named authority); restore from the verified backup.
5. Assert: the system is byte-for-byte the pre-cutover state; the legacy system resumes; `migration_runs.status = 'rolled_back'`.

**PASS**: backup restores cleanly to the exact pre-cutover state (100% restorable); end-to-end runbook with injected failure completes and correctly triggers rollback.

---

## Gate before any real cutover

All five scenarios PASS on the production copy **and** `npx tsc --noEmit` + `npm run lint` +
`npm run test:unit` green **and** `npm run sb:advisors` clean — before the fixed-date cutover is
scheduled. Stripe goes live only after Scenarios 1–3 pass on the real run (keys/config only); Scenarios 4–5 pass on the production-copy rehearsal as final assurance gates (idempotency + rollback).

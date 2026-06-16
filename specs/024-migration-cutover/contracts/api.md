# Contracts: Data Migration + Big-Bang Cutover (Spec 024)

**Input**: `specs/024-migration-cutover/spec.md`
**Branch**: `024-migration-cutover` | **Date**: 2026-06-16

This phase is **operational**, not REST-heavy. The primary interface is the migration
script/function; the admin endpoints are read/observe surfaces plus a restricted rollback trigger.
The cutover runbook itself is documented here as a contract (ordered step sequence + rollback
criteria), since the cutover's safety lives in the procedure, not in app code.

---

## 1 · Migration script interface

### `run_migration(dry_run boolean, resume_from_run_id text DEFAULT NULL) → MigrationRunResult`

Idempotent, atomic-or-resumable (R-003). Service-role / operator only; never callable by
`anon`/`authenticated`.

- **`dry_run = true`**: executes the full pipeline against the rehearsal copy and emits the three reconciliation reports **without** finalizing (no Stripe flip, no legacy retirement). Required before any real run (FR-012).
- **`resume_from_run_id`**: resumes an interrupted run using `migration_runs` + `migration_entity_markers`, skipping already-processed entities. Omitted ⇒ a fresh run with a new `run_id`.
- **Guarantees**: re-run ⇒ 0 double-grants / 0 duplicated progress rows / 0 double-converted balances (FR-009); every progress write passes the ayah-range guard (NFR-001); RLS untouched (NFR-002).
- **Returns**: `{ run_id, status, phase, reports: { progress, tierMapping, balance }, manualReviewCount }`.

---

## 2 · Admin endpoints (all admin-authenticated, RLS-enforced)

### `GET /api/admin/migration/reconciliation`
- **Auth**: admin only.
- **Returns**: the three reconciliation reports for the latest (or `?run_id=`) run — progress integrity, tier mapping, balance conversion — each with PASS/FAIL and itemized deltas.
- **Use**: the verification gate; all three must PASS before the Stripe flip.

### `GET /api/admin/migration/manual-review`
- **Auth**: admin only.
- **Returns**: paginated `manual_review_bucket` rows (`user_id`, `legacy_arrangement`, `reason`, `resolved`).
- **Use**: surfaces every user with no clean tier equivalent for human placement (FR-002).

### `POST /api/admin/migration/rollback`
- **Auth**: admin **with a restricted rollback role** (the named rollback authority — see Open Items / [NEEDS CLARIFICATION]).
- **Body** (zod): `{ run_id, reason, confirm: true }`.
- **Effect**: triggers the restore-from-verified-backup procedure (FR-020/021); records `migration_runs.status = 'rolled_back'`. If invoked **after** the Stripe live flip, the response includes the captured-live-payments handling policy (held/refunded) the operator must execute.
- **Idempotent**: a second call for an already-rolled-back run is a no-op.

> All endpoints validate input with zod at the route handler; `userId`/role come from the authenticated session, never request input; service-role key stays server-only.

---

## 3 · Rollback trigger criteria (contract)

Rollback is invoked by the named authority when **any** of the following trips:

1. Any reconciliation report (progress / tier / balance) returns **FAIL**.
2. Data corruption detected (e.g. a student's memorized-ayat total changed; ayah-range guard reported a bypass attempt).
3. The migration aborts and a safe **resume** is not possible (must restore-from-backup instead).
4. Schema-history reconciliation (`migration repair` / post-baseline apply) fails ⇒ **halt before any data migration**, never `db push` the baseline.

A failed verification **leaves Stripe in test mode** (FR-018). Rollback after the live flip additionally requires the captured-live-payments handling step.

---

## 4 · Cutover runbook (ordered step sequence — contract)

The procedure is the safety net. Steps execute in this exact order; each gates the next.

| # | Step | Gate / invariant |
|---|------|------------------|
| 1 | **Freeze** financial/booking writes | short, pre-announced; migration runs on a stable snapshot (FR-013) |
| 2 | **Restore-verified backup** of production | restorability confirmed **before** any destructive step (FR-014) |
| 3 | **Reconcile schema history** (`migration repair --status reverted` ×~103, then post-baseline apply) | clean deploy; baseline never `db push`ed; **halt → abort** on failure (FR-015) |
| 4 | **Run migration** (`run_migration(dry_run=false)`) | idempotent + atomic-or-resumable; ayah-range guard active; RLS intact (FR-003/004/009/010) |
| 5 | **Verification gates** (3 reconciliation reports) | all PASS required; any FAIL ⇒ rollback, Stripe stays test (FR-011, FR-018) |
| 6 | **Flip Stripe test→live** (keys/config only) | no code change; **only after** step 5 passes (FR-018/019) |
| 7 | **Retire legacy** one-time-package + per-session-booking write paths | new system is sole active system (FR-017) |
| 8 | **Unfreeze** | freeze window bounded and communicated; 0 learners lose access/progress/balance (SC-009) |

Rollback (restore-from-verified-backup) is available at any step per the criteria in §3.

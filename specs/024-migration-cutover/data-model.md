# Data Model: Data Migration + Big-Bang Cutover (Spec 024)

**Input**: `specs/024-migration-cutover/spec.md`
**Branch**: `024-migration-cutover` | **Date**: 2026-06-16

This spec is **migration logic + operational runbook**, not a feature build. It introduces only
two small operational tables (a run ledger and a manual-review bucket); everything else is a
*migration target* owned by a prior spec and **not redefined here**. All new migrations are
timestamped to sort **after** `20260428000000_remote_baseline.sql`; RLS is preserved on every
touched table; the baseline is never `db push`ed.

---

## New tables (this spec)

### `migration_runs` — idempotency / resumability ledger

Tracks each migration execution so a re-run is idempotent and an interrupted run is resumable
(R-003). One row per run; per-entity processed markers reference it.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `run_id` | text UNIQUE NOT NULL | operator-supplied stable run identifier |
| `started_at` | timestamptz NOT NULL DEFAULT now() | |
| `completed_at` | timestamptz NULL | set on terminal status |
| `status` | `migration_run_status` ENUM (`running`,`completed`,`rolled_back`,`failed`) | |
| `phase` | text NOT NULL | current runbook phase (schema_reconcile / progress / tier / balance / bookings / verify) |
| `notes` | text NULL | operator/diagnostic notes |

- **Companion**: `migration_entity_markers (run_id text FK, entity_kind text, entity_id uuid, processed_at timestamptz, PRIMARY KEY (run_id, entity_kind, entity_id))` — exactly-once marker per entity; resume skips processed entities.
- **RLS**: admin-only `SELECT`; `service_role` `INSERT`/`UPDATE`. No `anon`/`authenticated` access. RLS enabled in the same migration.
- **Guards**: `BEFORE UPDATE OF (run_id, started_at)` immutable; status transitions forward-only.

### `manual_review_bucket` — users with no clean tier equivalent

Holds users whose legacy arrangement has no deterministic catalog equivalent (FR-002). Never a
silent drop; surfaced to admins for human placement.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL FK `profiles(id)` | the unmapped user |
| `legacy_arrangement` | jsonb NOT NULL | snapshot of the legacy package/booking arrangement |
| `reason` | text NOT NULL | why no clean equivalent (e.g. `no_matching_tier`, `merge_conflict`) |
| `resolved` | boolean NOT NULL DEFAULT false | admin resolves after manual placement |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

- **RLS**: admin-only `SELECT`/`UPDATE`; `service_role` `INSERT`. No `anon`/`authenticated`. RLS enabled in the same migration.
- **Guards**: `BEFORE UPDATE OF (user_id, legacy_arrangement)` immutable; only `resolved` is mutable by admin.

---

## Reconciliation report (generated artifact — NOT a table)

The cutover-success gate (FR-011, SC-001/002/003). Generated per run, per domain, before/after:

- **Progress integrity**: per student, total memorized ayat **unchanged** (neither decreased nor increased) vs legacy; ayah-range guard never fired a bypass; murajaah/SM-2 state carried forward. PASS ⇒ 100% of students unchanged.
- **Tier mapping**: every active user has exactly one placement — an equivalent tier/product **or** an explicit `manual_review_bucket` row. PASS ⇒ 0 silent drops.
- **Balance conversion**: per-student before/after ledger; `SUM(legacy outstanding) = SUM(converted entitlement)` within the documented policy, every adjustment itemized. PASS ⇒ 0 unexplained forfeitures.

All three reports must PASS before the cutover is declared successful and before the Stripe live flip.

---

## Reused tables (migration TARGETS — defined elsewhere, NOT redefined here)

| Table / structure | Owner | Role in this migration |
|-------------------|-------|------------------------|
| `subscriptions`, `subscription_plans` | spec 018 | new-model placement target (entitlement/grant primitives) |
| `packages`, `student_packages` | spec 019 (+ legacy) | legacy arrangement **source**; `student_packages` is a balance source |
| `subscription_teacher_assignments` | spec 020 | target for preserved student↔teacher linkage (FR-007) |
| `profiles` | core | legacy user/arrangement source; placement subject |
| `bookings` | core | legacy booking source; in-flight resolution (FR-008) |
| `student_progress` + murajaah/SM-2 scheduler state | core | **sacred** hifz source → superset-merge target (guarded) |
| `student_credits` | core | legacy balance source (FR-006) |
| `schema_migrations` | prod-only | history reconciliation surface (~103 pre-baseline versions, R-001) |

RLS remains enabled with policies intact on **every** table above during and after migration.

---

## Mapping rules (documented data/policy — not hardcoded)

- **user → tier**: deterministic rule matching legacy arrangement (individual vs group, session count/duration) to the closest catalog tier (spec 019); existing teacher linkage preserved into `subscription_teacher_assignments`; no clean equivalent ⇒ `manual_review_bucket`.
- **balance → entitlement**: deterministic conversion of remaining `student_packages` / `student_credits` value into a spec-018 grant/credit; zero balance ⇒ no entitlement; mid-cycle remainders itemized in the ledger.

> ⚠️ The **exact** balance-conversion policy and the fixed cutover timestamp are **[NEEDS CLARIFICATION]** in the spec — see plan.md Open Items. They are data/policy, never invented by a model.

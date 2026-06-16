# Implementation Plan: Data Migration + Big-Bang Cutover

**Branch**: `024-migration-cutover` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/024-migration-cutover/spec.md`
**Phase**: م٧ (data migration + cutover) — the final phase of the Subscription + Courses Pivot

---

## Summary

This is the **switchover event**, not a feature build. It (1) migrates all existing data — user→tier
placement, legacy balance→entitlement conversion, and especially **hifz progress** (superset-merged
through `student_progress_ayah_range_guard`, never overwritten/reset/overstated, with murajaah/SM-2
scheduler state carried forward) — and (2) executes a single fixed-date **big-bang cutover**.

The **real deploy blocker** is the production `schema_migrations` reconciliation (~103 pre-baseline
versions → `migration repair --status reverted`, then apply post-baseline migrations; the baseline
is **never** `db push`ed) — not application code, which specs 018–023 already shipped. The migration
is **idempotent + atomic-or-resumable** via a `migration_runs` ledger, with a per-student balance
conversion ledger. The cutover follows a fixed runbook —
**freeze → restore-verified backup → reconcile schema history → migrate → verify → flip Stripe
(keys-only) → retire legacy → unfreeze** — with a documented rollback (restore-from-backup) and
explicit trigger criteria. Stripe flips test→live **by keys/config only, after verification passes**.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router
**Primary Dependencies**: Supabase JS v2, Supabase CLI (`migration repair`/`migration up`), Zod v3, Stripe (keys/config)
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` timestamped **after** `20260428000000_remote_baseline.sql`
**Testing**: Vitest (unit — mapping/merge/conversion/idempotency/rollback), local Postgres rehearsal on a production copy, Playwright for admin endpoints
**Target Platform**: Vercel serverless; migration run server-only / operator-invoked
**Constraints**: RLS preserved on every touched table; ayah-range guard never bypassed; exact `surah:ayah` byte-for-byte; progress merged-never-overwritten; baseline never `db push`ed; idempotent + atomic-or-resumable; Stripe test→live keys/config-only after verification; production data never copied to insecure locations; credentials never inlined; restore-verified backup before any destructive step; rollback authority named; cutover instant an unambiguous absolute timestamp
**Scale/Scope**: full production user base — bounded at **~50,000 students** for runtime/freeze sizing (constitution scale-evaluation gate, NFR-006); migration runtime and the cutover freeze window are rehearsal-measured at this scale, with the runbook freeze duration derived from that measured run; ~103 pre-baseline schema versions to reconcile; one freeze window

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS preserved (enabled + policies) on **every** touched table, during & after | ✅ PASS | NFR-002; new `migration_runs` / `manual_review_bucket` ship RLS in-migration |
| `student_progress_ayah_range_guard` never disabled/bypassed | ✅ PASS | NFR-001/FR-004; every progress write passes the guard |
| Exact `surah:ayah` preserved byte-for-byte; progress merged never overwritten/reset/overstated | ✅ PASS | FR-003; superset-merge only |
| Baseline `20260428000000_remote_baseline.sql` **never** `db push`ed | ✅ GATE | FR-015; reconcile via `migration repair --status reverted`; new migrations sort after baseline |
| Production-copy rehearsal before any prod run | ✅ GATE | FR-012/NFR-003; all 5 quickstart scenarios pass first |
| Restore-verified backup before any destructive step | ✅ GATE | FR-014; restorability confirmed |
| Idempotent (re-run 0 duplicates) + atomic-or-resumable | ✅ PASS | FR-009/010; `migration_runs` ledger + entity markers |
| `sb:advisors` clean for changes | ✅ GATE | FR-016/NFR-003 |
| Stripe test→live **keys/config only, after verification passes** (fail ⇒ stays test) | ✅ PASS | FR-018/019; 0 code changes (SC-007) |
| Production data never to insecure locations; credentials never inlined | ✅ PASS | NFR-004 |
| `tsc --noEmit` + `lint` + `test:unit` green | ✅ GATE | NFR-005 |

---

## Project Structure

### Source Code Layout

```text
scripts/migration/
├── run-migration.ts            ← run_migration(dry_run, resume_from_run_id) orchestrator (idempotent, atomic-or-resumable)
├── reconcile-schema-history.ts ← ~103 `migration repair --status reverted`, then post-baseline apply (R-001)
└── mapping/
    ├── user-to-tier.ts         ← deterministic user→tier rule; no clean equiv ⇒ manual_review_bucket
    └── balance-to-entitlement.ts ← deterministic balance→entitlement conversion + per-student ledger

src/lib/domains/migration/
├── progress-merge.ts           ← hifz superset-merge through ayah-range guard + murajaah/SM-2 carry-forward
├── reconciliation.ts           ← progress / tier-mapping / balance reconciliation report generators
└── ledger.ts                   ← migration_runs + entity-marker read/write helpers

src/app/api/admin/migration/
├── reconciliation/route.ts     ← GET 3 reports (admin)
├── manual-review/route.ts      ← GET manual_review_bucket (admin)
└── rollback/route.ts           ← POST restore-from-backup trigger (restricted rollback role)

supabase/migrations/
└── 20260620000000_migration_ops_tables.sql
    — migration_run_status enum + migration_runs + migration_entity_markers
    — manual_review_bucket + RLS (admin-only read, service_role write) + BEFORE UPDATE guards

docs/runbooks/
└── 024-cutover-runbook.md      ← ordered runbook + rollback plan + trigger criteria (operational artifact)
```

---

## Key Implementation Decisions

1. **Schema-history reconciliation is the deploy blocker, owned here**: `reconcile-schema-history.ts` scripts `migration repair --status reverted` for each pre-baseline version, then applies post-baseline migrations. The baseline is never `db push`ed. Reconciliation runs **before** any data migration; on failure the cutover **halts and aborts** (never force-push).

2. **Hifz superset-merge through the guard**: `progress-merge.ts` computes the additive superset of legacy ranges per student and writes through `student_progress_ayah_range_guard` (never disabled). murajaah/SM-2 state is copied forward unchanged. Unmergeable conflicts ⇒ `manual_review_bucket`, never guessed.

3. **Idempotent + atomic-or-resumable via ledger**: `migration_runs` + `migration_entity_markers` give exactly-once processing per entity. Re-run is a no-op; an interrupted run resumes via `resume_from_run_id` or restores from backup. Never a half-migrated DB.

4. **Balance conversion with a per-student ledger**: `balance-to-entitlement.ts` applies the documented deterministic policy; emits before/after per student; reconciles `SUM(legacy) = SUM(converted)`. Zero-balance ⇒ no entitlement; mid-cycle remainders itemized.

5. **Runbook-as-contract with keys-only Stripe flip**: the cutover's safety lives in the ordered runbook (freeze → backup → reconcile → migrate → verify → flip → retire → unfreeze). Stripe goes live by keys/config only, **after** the three reconciliation reports PASS; a FAIL leaves Stripe in test mode and triggers rollback.

---

## Open Items — [NEEDS CLARIFICATION] (preserved from spec, NOT invented)

| # | Open item | Blocks |
|---|-----------|--------|
| 1 | **Fixed cutover DATE/TIME** — must be chosen, expressed as an unambiguous absolute timestamp, and pre-announced before scheduling the freeze (FR-022). | Scheduling the freeze window; future-dated booking classification |
| 2 | **Exact legacy-balance→new-entitlement conversion policy** — how remaining package credits / `student_credits` map to grants/credits, and how mid-cycle remainders are valued; a deterministic, reconcilable rule is required (FR-006). | Balance conversion (US3) + ledger reconciliation |
| 3 | **Rollback decision authority** — which named role is authorized to invoke rollback, and the go/no-go sign-off owner for the verification gates (FR-020). | Rollback endpoint role + cutover sign-off |

These are **data/policy/operational** decisions for a human; a model must not invent values for them.

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ✅ Complete |

# Research: Data Migration + Big-Bang Cutover (Spec 024)

**Input**: `specs/024-migration-cutover/spec.md`
**Branch**: `024-migration-cutover` | **Date**: 2026-06-16

This phase (م٧) is operational, not feature-bearing. The research below resolves the
*how* of moving production data and flipping the switch, through the three lenses
(🛠 engineer · 📖 Quran teacher · 🎓 platform expert).

---

## R-001 — Production `schema_migrations` reconciliation is the REAL deploy blocker

**Decision**: Reconcile the prod migration history *before* any data migration runs. Prod
`schema_migrations` lists ~103 pre-baseline versions that predate
`20260428000000_remote_baseline.sql` (the remote pg_dump = prod HEAD). The fix is, for each
pre-baseline version, `supabase migration repair --status reverted <version>`, then apply the
post-baseline timestamped migrations normally. The baseline itself is **NEVER** `db push`ed —
force-pushing it would attempt to recreate the entire prod schema and is catastrophic.

**Rationale**: The app code is shipped (018–023); what stops a clean deploy is the history
mismatch, not application logic. Marking pre-baseline versions `reverted` realigns the ledger
with what the baseline already captured, so only genuinely-new (post-baseline) migrations apply.
This is documented project topology (memory: Supabase migration topology / spec 011).

**Alternatives considered**:
- *`db push` the baseline* — rejected: re-runs the full schema against live prod, destructive, explicitly forbidden.
- *Hand-edit `schema_migrations`* — rejected: bypasses CLI invariants, undocumented, unrepeatable on the rehearsal copy.
- *Squash into a new baseline* — rejected: out of scope for a cutover; risks drift vs the verified remote dump.

**Scale check**: ~103 one-line `migration repair` calls, scripted and idempotent; runs in the rehearsal first. Halts the cutover before data migration if it fails (Edge Case: schema-history reconciliation failure).

---

## R-002 — Hifz progress: superset-merge through the ayah-range guard, scheduler carried forward

**Decision**: For each student, the post-migration set of memorized `surah:ayah` ranges is the
**exact superset-merge** of their legacy ranges — never narrowed, widened, reset, or overstated.
Every write passes through `student_progress_ayah_range_guard` (never disabled/bypassed). murajaah /
SM-2 scheduler state (intervals, due dates, ease factors) is carried forward **unchanged** so no
completed review repeats and no due review is dropped. Conflicts that cannot be safely merged are
flagged to the manual-review bucket, never guessed.

**Rationale**: AGENTS.md §2/§4 — Quran progress is the platform's sacred, irreplaceable data; a
model may never fabricate it. Merge-not-overwrite is a hard rule. The guard is the only authority
on range validity (validated against `src/lib/quran/ayah-counts.ts`); bypassing it could admit an
invalid range byte-for-byte.

**Alternatives considered**:
- *Overwrite from a single "best" legacy table* — rejected: violates merge-not-overwrite; silently loses ranges in other tables.
- *Recompute progress from session history* — rejected: model-generated progress is forbidden; lossy and non-deterministic.
- *Reset murajaah schedule post-migration* — rejected: forces learners to re-review completed material — pedagogical harm.

**Scale check**: One merge pass per student over `student_progress` + scheduler rows; superset-merge is associative/idempotent, so a re-run yields the identical set (supports R-003).

---

## R-003 — Idempotent + atomic-or-resumable migration via a run ledger

**Decision**: The migration script is **idempotent** (re-run ⇒ 0 double-grants, 0 duplicated
progress rows, 0 double-converted balances) and **atomic-or-resumable** (an interrupted run never
leaves the DB half-migrated — recovery is either safe resume or restore-from-backup). Implement with
a `migration_runs` ledger plus per-entity processed markers, so each entity is processed
exactly-once and a resumed run skips completed entities.

**Rationale**: Big-bang has no incremental safety net (spec §US4); the safety must live in the
procedure. Idempotency lets the operator re-run after a transient failure without corruption;
resumability avoids re-doing expensive work; restore-from-backup is the floor if resume is unsafe.

**Alternatives considered**:
- *One giant transaction* — rejected: a multi-hour single txn risks lock bloat/timeout and an all-or-nothing failure with no partial progress visibility.
- *No ledger, rely on natural keys only* — rejected: works for grants but not for multi-step per-student flows; no resume point, no audit trail.
- *Truncate-and-reload each run* — rejected: destructive, not safe against live prod, defeats resumability.

**Scale check**: One ledger row per run + one marker per entity (students/balances/bookings); markers indexed by `(run_id, entity_id)` for O(1) skip on resume.

---

## R-004 — Balance conversion to new-model entitlement with a per-student ledger

**Decision**: Convert each student's remaining legacy balance (`student_packages` /
`student_credits`) into a new-model entitlement (grant/credit from spec 018) per a **documented,
deterministic** conversion policy. Emit a per-student before/after ledger: **0** silent forfeiture
for non-zero balances, **0** spurious entitlement for zero-balance users. Total legacy outstanding
balance must reconcile to total converted entitlement within the policy, every adjustment itemized.

**Rationale**: Voiding paid-for value is a financial-integrity failure and a day-one trust/churn
disaster (spec §US3). A per-student ledger makes the conversion auditable and reconcilable, and is
the gate evidence for SC-003.

**Alternatives considered**:
- *Forfeit remaining balance at cutover* — rejected: silent value destruction; trust/churn catastrophe.
- *Flat per-user credit regardless of balance* — rejected: not reconcilable; over/under-grants; not deterministic.
- *Best-effort estimate of mid-cycle value* — rejected: ambiguous remainders must be itemized, not absorbed; needs the documented policy ([NEEDS CLARIFICATION] in spec).

**Scale check**: One read + one conversion + one ledger row per student with non-zero balance; reconciliation is a single SUM(before) = SUM(after) assertion per the policy.

---

## R-005 — Cutover ordering + Stripe test→live flip (keys only, after verification)

**Decision**: Fixed-sequence runbook: **freeze** (short, pre-announced, financial/booking writes) →
**restore-verified backup** → **reconcile prod schema history** (R-001) → **migrate** (R-002/003/004) →
**verification gates** (progress / tier / balance reconciliation reports all pass) → **flip Stripe
test→live by KEYS/CONFIG ONLY** (no code change, only after verification passes) → **retire legacy
booking/package paths** → **unfreeze** → **post-cutover reconciliation/verification** (re-run the 3
reports against the live system + a legacy-paths-retired smoke check; FR-023). A failed verification
**leaves Stripe in test mode** and triggers the rollback path (restore-from-verified-backup).
"Restore-verified" backup means restore-exercised with row-count + checksum parity vs source (FR-014).

**Rationale**: Ordering encodes the safety: backup before any destructive step; schema reconcile
before data migration (halt-before-migrate on failure); Stripe live only after data is proven, so
real cards are never charged against unverified state (spec Edge Case: Stripe key flip ordering).
Keys-only flip means the test→live transition needs 0 code changes (SC-007).

**Alternatives considered**:
- *Flip Stripe live before/with migration* — rejected: could charge real cards against unverified data; spec forbids.
- *Code-change toggle for live mode* — rejected: introduces a deploy in the cutover window; keys/config-only is the contract.
- *Skip the freeze for a "live" migration* — rejected: migration must run against a stable snapshot; no incremental net exists.

**Scale check**: Single bounded freeze window; one backup; one migration run; three reconciliation reports gate the flip. Rollback-after-live-charges handling is a documented policy item (FR-021) whose held-vs-refunded rule is an explicit [NEEDS CLARIFICATION] (Open Item #4, fail-closed until supplied), and the cutover instant is an unambiguous absolute timestamp (FR-022) — both [NEEDS CLARIFICATION] in the spec.

---

## Cross-cutting constraints (apply to every decision above)

- RLS stays enabled with policies intact on **every** touched table, during and after migration (NFR-002).
- `student_progress_ayah_range_guard` is **never** disabled/bypassed; exact `surah:ayah` preserved byte-for-byte (NFR-001, FR-004).
- New migrations timestamped **after** `20260428000000_remote_baseline.sql`; baseline never `db push`ed (FR-015/016).
- Production data never copied to insecure/shared locations; credentials never inlined into commands (NFR-004).
- All money/grant/progress logic verified locally in Postgres against a production copy before prod execution; `sb:advisors` clean (NFR-003).

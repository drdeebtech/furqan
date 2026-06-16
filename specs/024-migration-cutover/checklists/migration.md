# Migration & Cutover Safety Requirements Checklist

**Purpose**: Unit-test the *requirements* (not the implementation) for spec 024's big-bang data migration + cutover, focused on migration-safety and rollback requirement quality — are the safety, reconciliation, and recovery requirements complete, unambiguous, measurable, and internally consistent before any code or rehearsal is trusted?
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

**How to read this**: Each item is a *question about the requirement text*, not an instruction to verify runtime behavior. Answer YES (requirement is sound) or NO (defect — fix the spec). Tags cite the source `§ref` or the gap marker `[Gap]/[Ambiguity]/[Conflict]/[Assumption]`.

## Completeness

- [ ] CHK001 Confirm the migration freeze-window duration is explicitly bounded for the production scale (50,000 students), with the migration runtime rehearsal-measured at that scale and the freeze sized from it (NFR-006 now present — verify the runbook freeze duration is derived from the measured 50k-scale run, not left unsized). [Completeness, RESOLVED — NFR-006 / SC-009 / FR-013, constitution scale eval]
- [ ] CHK002 Are requirements present for *every* runbook step (freeze, backup, reconcile, migrate, verify, flip, retire, unfreeze), each with a defined entry-gate and exit-gate? [Completeness, contracts/api.md §4]
- [ ] CHK003 Is there a requirement defining what constitutes a "verified" backup (restore actually exercised, not just taken)? [Completeness, FR-014]
- [ ] CHK004 Is the set of tables whose RLS must remain enabled during/after migration enumerated, including the two new ops tables and all migration targets? [Completeness, NFR-002 / data-model.md §Reused]
- [ ] CHK005 Is a requirement present covering the post-cutover verification/reconciliation that confirms success *after* unfreeze, distinct from the pre-flip gates? [Completeness, Gap — spec §Scope "post-cutover reconciliation/verification" not mapped to an FR]
- [ ] CHK006 Confirm the early branch-hygiene task is present (open draft PR + tracking issue / `Closes #N`) before the second implementation task, not VCS commit only at the end (T001a now present — verify it precedes T002+ and references the tracking issue). [Completeness, RESOLVED — tasks.md T001a; T039 still does the final commit]
- [ ] CHK007 Is the captured-live-payments handling requirement (held vs refunded) for a post-Stripe-flip rollback fully specified, or only named? [Completeness, FR-021 / edge "Rollback after Stripe is live"]
- [ ] CHK008 Are the three `[NEEDS CLARIFICATION]` open items (cutover timestamp, balance-conversion policy, rollback authority) each documented as an *explicit open decision with a named human owner type*, not silently assumed? [Completeness, spec §Clarifications / plan.md Open Items]

## Clarity & Measurability

- [ ] CHK009 Is "superset-merge, never overwritten/narrowed/reset/overstated" expressed as a measurable assertion (per-student memorized-ayat total unchanged), rather than a qualitative goal? [Clarity, FR-003 / SC-001]
- [ ] CHK010 Is "short freeze window" given a quantitative bound (minutes/hours), or is "short" left to interpretation? [Ambiguity, FR-013 / SC-009]
- [ ] CHK011 Confirm the pre-baseline version set is derived programmatically from prod `schema_migrations` at run time and no artifact treats "~103" as the authoritative count (T021 now derives at run time and labels ~103 as an approximation — verify the count is never hardcoded). [Clarity, RESOLVED — FR-015 / tasks.md T021 derives at run time]
- [ ] CHK012 Is "balance reconciles within the documented policy" measurable when the policy itself is an unresolved open item — i.e., is the fail-closed default unambiguous until the policy is supplied? [Ambiguity, FR-006 / SC-003 / open item #2]
- [ ] CHK013 Is "restore-verified" defined as a pass/fail check with an explicit success condition (e.g., row-count / checksum parity post-restore)? [Clarity, FR-014 / SC-005]
- [ ] CHK014 Is the cutover instant required to be a single absolute UTC timestamp, removing timezone ambiguity for future-dated booking classification? [Clarity, FR-022 / edge "Timezone of the cutover instant"]
- [ ] CHK015 Is "clean deploy" (schema reconciliation outcome) defined by a checkable condition, not just narrative? [Clarity, FR-015 / SC-006]
- [ ] CHK016 Are "idempotent" and "atomic-or-resumable" each defined by an observable test condition (re-run yields 0 dupes; interrupted run never half-migrated)? [Clarity, FR-009/FR-010 / SC-004]

## Consistency & Conflicts

- [ ] CHK017 Confirm no spec/plan/task wording still says "then db push" in the reconciliation step (spec Assumptions now reads "then apply post-baseline migrations (never `db push` the baseline)"); the only `db push` mentions remaining must be in a "never db push" context, consistent with FR-015. [Conflict, RESOLVED — spec §Assumptions reworded vs FR-015 / re-check data-model.md]
- [ ] CHK018 Are the schema-history requirements consistent across spec (FR-015), data-model (`schema_migrations` surface), and contracts (runbook step 3) on the *halt-and-abort on failure* behavior? [Consistency, FR-015 / contracts §4 step 3 / edge "Schema-history reconciliation failure"]
- [ ] CHK019 Is the Stripe ordering invariant ("live only after verification passes; FAIL ⇒ stays test") stated identically in FR-018, the edge case, and the runbook contract? [Consistency, FR-018 / edge "Stripe key flip ordering" / contracts §4 step 6]
- [ ] CHK020 Do FR-003 (progress) and the merge-conflict edge case agree that unmergeable conflicts route to manual-review and are never guessed? [Consistency, FR-003 / edge "Hifz progress merge conflict" / FR-002]
- [ ] CHK021 Is the rollback authority referenced consistently (single named-role concept) across FR-020, FR-021, the rollback endpoint, and the trigger-criteria contract? [Consistency, FR-020 / contracts §2 rollback / §3]
- [ ] CHK022 Do the success criteria (SC-001..SC-009) each trace back to exactly one or more FRs without an SC asserting something no FR requires? [Consistency, SC-001..009 vs FR-001..022]

## Acceptance Criteria Quality

- [ ] CHK023 Is SC-006 ("0 baseline force-pushes") stated with a defined verification method (how a force-push is detected/counted), or is it an unverifiable absolute? [Acceptance Criteria, SC-006]
- [ ] CHK024 Is SC-009 ("freeze bounded; 0 learners lose access/progress/balance the morning after") backed by a measurable bound and a defined check, given CHK001's missing freeze sizing? [Acceptance Criteria, SC-009]
- [ ] CHK025 Is SC-004 (idempotency: 0 duplicate grants/progress/balances) stated as a re-run assertion with an explicit before/after comparison method? [Acceptance Criteria, SC-004]
- [ ] CHK026 Is SC-005 ("100% restorable" + rehearsal rollback to exact pre-cutover state) measurable via a defined state-equality check? [Acceptance Criteria, SC-005]
- [ ] CHK027 Is SC-008 (full runbook + injected-failure correctly triggers rollback) defined with an explicit pass condition for "correctly triggers"? [Acceptance Criteria, SC-008]
- [ ] CHK028 Does every P1 user story have an Independent Test that asserts a *quantitative* reconciliation outcome rather than a qualitative observation? [Acceptance Criteria, US1–US4 Independent Tests]
- [ ] CHK029 Is each acceptance scenario phrased Given/When/Then with a checkable Then, avoiding unfalsifiable "behaves correctly" outcomes? [Acceptance Criteria, US1–US5 Acceptance Scenarios]

## Scenario & Edge Coverage (Recovery / Rollback)

- [ ] CHK030 Is the partial/interrupted-migration recovery requirement explicit on the *decision rule* between safe-resume and restore-from-backup (not left to operator judgment)? [Coverage, edge "Partial / interrupted migration" / FR-010]
- [ ] CHK031 Are the rollback trigger criteria enumerated and authoritative (which conditions force rollback), per the contract, and reflected in an FR? [Coverage, contracts §3 / FR-020]
- [ ] CHK032 Does a requirement cover rollback *after* the Stripe live flip, including the money-handling step beyond data rollback? [Coverage, FR-021 / edge "Rollback after Stripe is live"]
- [ ] CHK033 Is the in-flight booking scenario (future-dated + in-progress instant session spanning the freeze) covered with a deterministic resolution rule and exactly-once debit/credit? [Coverage, US5 / FR-008]
- [ ] CHK034 Is the duplicate/re-run scenario covered by a requirement, not only a success metric? [Coverage, edge "Duplicate / re-run" / FR-009]
- [ ] CHK035 Is the zero-balance case ("no spurious entitlement") explicitly required so conversion logic can't fabricate value? [Coverage, FR-006 / US3 scenario 2]
- [ ] CHK036 Is the "no clean tier equivalent ⇒ manual-review, never guessed" path required for both tier-mapping and progress-conflict origins? [Coverage, FR-002 / edge "User with no clean tier equivalent"]

## Non-Functional & Security

- [ ] CHK037 Is the prohibition on disabling the `student_progress_ayah_range_guard` stated as an absolute (no exception clause)? [Non-Functional, NFR-001 / FR-004]
- [ ] CHK038 Is the production-data-handling requirement (never copied to insecure/shared locations; credentials never inlined) specific enough to be auditable? [Non-Functional, NFR-004]
- [ ] CHK039 Confirm a scale/performance requirement bounds migration runtime at 50,000 students so the freeze-window bound (CHK001) is derivable (NFR-006 now sizes runtime + freeze at 50k and requires rehearsal measurement — verify it is gating, not advisory). [Non-Functional, RESOLVED — NFR-006, constitution scale eval]
- [ ] CHK040 Is `sb:advisors` clean required as a gating precondition (not advisory) for the changed tables? [Non-Functional, FR-016 / NFR-003]

## Dependencies & Assumptions

- [ ] CHK041 Are the prerequisite-spec assumptions (018–023 shipped & live as migration targets) stated as explicit preconditions that block the cutover if unmet? [Dependencies, spec §Assumptions / tasks.md Prerequisites]
- [ ] CHK042 Is the assumption that balance math / cutover timestamp are data-policy (never model-invented) stated as a hard constraint with a fail-closed default? [Assumption, spec §Assumptions / open items #1–#2]
- [ ] CHK043 Is the assumption that hifz lives in `student_progress` + murajaah/SM-2 state (and is the only sacred source) stated so a missed legacy source would surface as a gap, not a silent loss? [Assumption, spec §Assumptions / data-model.md]

## Notes

- Check items off as resolved: `[x]`. A NO answer is a requirement defect — fix the spec/plan/tasks, not the runtime.
- Traceability: 40 of 43 items cite a spec `§ref`; the remaining cite `[Gap]/[Conflict]/[Assumption]` markers (≥80% target met).
- Risk priority: freeze-window sizing (CHK001/CHK010/CHK024/CHK039), the "db push" conflict (CHK017), hardcoded ~103 (CHK011), and post-flip rollback money-handling (CHK007/CHK032) are the highest-risk requirement defects to close first.

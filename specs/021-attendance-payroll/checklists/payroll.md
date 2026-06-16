# Attendance & Payroll Requirements Checklist

**Purpose**: Unit-test the *requirements* of spec 021 (attendance, excuses, and teacher payroll) for the PAYROLL / MONEY and IDEMPOTENCY domain — interrogating requirement quality (completeness, clarity, consistency, measurability), NOT implementation behavior. Each item is a question about whether the written requirements are correct, unambiguous, and verifiable.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

---

## Completeness

- [ ] CHK001 Is the source column for the teacher hourly rate explicitly named, and is its existence on `profiles` (or a per-teacher settings row) stated as a precondition the spec must establish rather than assume? [Completeness, Spec FR-018 / Clarifications 2026-06-16 — `profiles.hourly_rate_usd` VERIFIED ABSENT]
- [ ] CHK002 Do the requirements assign responsibility for *adding* the `hourly_rate_usd` column in an EARLY migration (before `finalize_attendance` snapshots it), rather than leaving it to a late Phase-7 verify step (T025)? [Completeness, Gap — Clarifications vs tasks.md T025]
- [ ] CHK003 Is the substitute-teacher *selection source* specified — i.e., from where the actual deliverer / `actualTeacherId` is obtained when a substitute delivers a session? [Completeness, Gap — Spec FR-015]
- [ ] CHK004 Is the behavior of `run_monthly_payroll` for a teacher with zero delivered hours specified as a definite outcome (no row vs zero-value row), rather than left as "or"? [Completeness, Spec Edge Cases / FR-020]
- [ ] CHK005 Is the required handling of a missing or zero hourly rate at payroll time specified (fail loud / configuration error), and is it stated as a testable requirement rather than only an edge-case note? [Completeness, Spec Edge Cases — "Rate missing/zero"]
- [ ] CHK006 Do the requirements state how `payroll_period_month` is derived (UTC `date_trunc('month', delivered_at)`) inside the function requirement itself, not only in a data-model comment? [Completeness, Spec FR-019/FR-020 vs data-model.md]
- [ ] CHK007 Is the set of session outcomes that count as "delivered" (accrue payable hours) fully enumerated and mutually exclusive with the non-delivered set? [Completeness, Spec FR-019]
- [ ] CHK008 Are all financial/immutable columns that must be guarded by `BEFORE UPDATE OF` enumerated in a single authoritative place that the migrations must satisfy? [Completeness, Spec FR-023 / FR-013]
- [ ] CHK009 Is the payout ledger's required field set (teacher, period, hours, rate, amount, status, run timestamp) complete and each field's source defined? [Completeness, Spec FR-022]
- [ ] CHK010 Do the requirements specify what the `reason` value of an auto-generated `subscription_extensions` row must contain for audit traceability? [Completeness, Gap — Spec FR-013]

## Clarity & Measurability

- [ ] CHK011 Is the `subscription_extensions` idempotency anchor specified as `booking_id` (always present) consistently across spec, data-model, plan, and tasks T003/T006/T017? [Clarity, Spec §FR-011 — resolved 2026-06-16; `session_id` retained only as nullable audit link]
- [ ] CHK012 Is "restored exactly once / at most once" defined as a measurable post-condition (e.g., `credit_action = 'restored'` set once; restore fn not re-invoked) rather than a prose adjective? [Measurability, Spec FR-003 / SC-002]
- [ ] CHK013 Is the carry-over extension's idempotency expressed as a concrete, checkable invariant (e.g., a unique constraint keyed on the anchor) rather than only "MUST be idempotent"? [Measurability, Spec FR-012]
- [ ] CHK014 Is "equivalent extension" quantified (which duration value, in seconds, maps to `extension_seconds`) so two implementers would compute the same number? [Clarity, Spec FR-011]
- [ ] CHK015 Is the payout amount formula stated unambiguously, including rounding rule and units (USD, 2dp), so the expected value is computable from inputs? [Measurability, Spec FR-020 / FR-022]
- [x] CHK016 Is the month-attribution boundary specified as UTC and tied to a named timestamp, with both spec and data-model agreeing on which? [Clarity, RESOLVED 2026-06-16 — spec Edge Cases now use `delivered_at` (canonical), `payroll_period_month = date_trunc('month', delivered_at)`, matching data-model.md; the prior `started_at` reference is gone. Verify: no `started_at` remains as the attribution timestamp.]
- [ ] CHK017 Is the excuse eligibility boundary stated as an inclusive, computable comparison (`submitted_at <= session_start - threshold`) with the threshold sourced from settings? [Measurability, Spec FR-007 / Edge Cases]
- [ ] CHK018 Is the rate-at-delivery snapshot rule measurable — i.e., the requirement names where the snapshot is taken and that a later rate change MUST NOT alter a closed month? [Measurability, Spec US5 scenario 4 / FR-019]
- [ ] CHK019 Is "the student is made whole" for teacher-absence defined in measurable terms (credit restored if debited, 0 student-absence counts, 0 debits) rather than as a goal statement? [Measurability, Spec FR-016 / SC-005]
- [ ] CHK020 Is the per-teacher-per-month uniqueness of a payout expressed as a concrete constraint requirement, not just "exactly one payout"? [Measurability, Spec FR-021 / SC-006]

## Consistency

- [x] CHK021 Do spec, contracts/api.md, plan, and data-model agree on the duplicate-attendance-record response? [Consistency, RESOLVED 2026-06-16 — contracts/api.md §1 now documents a 200 idempotent no-op (returning the existing `attendanceRecordId`) per Clarifications + plan decision #2; the `409 outcome already finalized` response was removed. Verify: no `409` finalize response remains.]
- [x] CHK022 Is the owner of the `subscription_extensions` INSERT consistent across artifacts — the `finalize_attendance` SECURITY DEFINER function ONLY, never the route layer? [Consistency, RESOLVED 2026-06-16 — contracts/api.md §3 now states the extension is inserted inside `finalize_attendance` only (route never inserts), avoiding a double-insert; matches Clarifications + tasks T006. Verify: no route-layer `subscription_extensions` insert remains.]
- [x] CHK023 Is the list of `BEFORE UPDATE OF` guarded columns identical across plan.md, tasks.md (T004–T005), and data-model.md (e.g., does `delivered_at` appear for `session_deliveries`)? [Consistency, RESOLVED 2026-06-16 — tasks.md T005 `session_deliveries` guard now includes `delivered_at`, matching data-model.md. Verify: `delivered_at` present in the T005 guard column list.]
- [ ] CHK024 Do the requirements use one consistent term for the rate column (`hourly_rate_usd`) across spec, plan, tasks, and data-model, with no competing names? [Consistency, Spec FR-018]
- [ ] CHK025 Is the `excuse_status` enum consistent between data-model (`pending/accepted/rejected/ineligible`) and the API success payloads (`pending/ineligible/accepted/rejected`) and FR-009's "undecided" notion? [Consistency, Spec FR-007/FR-009 vs data-model.md vs contracts/api.md]
- [ ] CHK026 Is the credit outcome of an unexcused absence consistently described as "debited (lost)" with NO restore call, in every place it appears (FR-002, US1, Assumptions)? [Consistency, Spec FR-002 / SC-001]
- [ ] CHK027 Do the requirements consistently state that `restore_student_package` is *reused, never redefined*, for excused-carried AND teacher-absent paths? [Consistency, Spec FR-003 / FR-016 / FR-025]
- [ ] CHK028 Is the payroll run-date setting consistently named and unit-defined — `payroll_run_day_of_month` (a day integer) vs the prose "first of the following month" and "run date setting is in UTC"? [Consistency, Spec FR-020 / Edge Cases vs data-model.md settings table]

## Acceptance Criteria Quality

- [ ] CHK029 Are the SC-00x success criteria each expressed with a measurable target (100% / 0 duplicates / 0 unauthorized mutations) tied back to a specific FR? [Acceptance Criteria, Spec SC-001..SC-008]
- [ ] CHK030 Does an acceptance scenario exist asserting that re-running payroll for the same month yields 0 new payouts (idempotent), with a defined pre/post state? [Acceptance Criteria, Spec US5 scenario 3 / SC-006]
- [ ] CHK031 Does an acceptance scenario assert that a rate change after month close does NOT alter the closed month's payout, stated as a checkable expectation? [Acceptance Criteria, Spec US5 scenario 4]
- [ ] CHK032 Is there an acceptance criterion that an unauthorized actor cannot alter a payout amount or mark it paid (financial-column guard + admin/service-role only)? [Acceptance Criteria, Spec FR-023 / US5 scenario 5 / SC-008]
- [ ] CHK033 Is there an acceptance criterion that a double carry-over produces exactly one extension row (not two)? [Acceptance Criteria, Spec US3 scenario 3 / FR-012]

## Scenario / Edge Coverage

- [ ] CHK034 Do the requirements cover the "double outcome / retry" case so a session can never be both debited and restored, with a single-valued finalization invariant? [Edge Coverage, Spec FR-004 / Edge Cases]
- [ ] CHK035 Is the "teacher absent AND student absent" classification rule specified (resolves to teacher-absent, student held harmless)? [Edge Coverage, Spec Edge Cases / FR-014]
- [ ] CHK036 Is the "session-spanning-a-month-boundary" payroll attribution rule specified with a single deterministic timestamp and UTC boundary? [Edge Coverage, Spec Edge Cases / FR-019]
- [ ] CHK037 Is the substitute-delivers-the-session case covered so payable hours follow the actual deliverer and never the absent teacher? [Edge Coverage, Spec FR-017 / US4 scenario 4 / SC-007]
- [ ] CHK038 Is the "carry-over extension at period end of a canceling subscription (`cancel_at_period_end = true`)" case specified as still honored? [Edge Coverage, Spec Edge Cases]
- [ ] CHK039 Is the "restore for a session whose credit was already restored" (teacher-absent then excused) case specified as restore-at-most-once and measurable? [Edge Coverage, Spec Edge Cases / FR-003 / FR-016]

## Non-Functional / Verification

- [ ] CHK040 Does NFR-002 enumerate the exact money cycles to be locally verified in Postgres (unexcused stays lost, excused restored-once-idempotent, teacher-absent restored, full-month payroll single+idempotent) as a measurable acceptance gate? [Non-Functional, Spec NFR-002]
- [ ] CHK041 Is the requirement that all financial/hour/outcome writes are service-role-only (no authenticated INSERT/UPDATE/DELETE) stated as a verifiable RLS/guard condition per table? [Non-Functional, Spec FR-024 / NFR-001]
- [ ] CHK042 Are monetary-value validation rules (USD only, reject negative and non-USD for rate and payout) stated as testable input constraints? [Non-Functional, Spec FR-026]

## Dependencies & Assumptions

- [ ] CHK043 Is the assumption that each session carries/derives a usable duration (for both hour accrual and extension sizing) flagged as a dependency that must be confirmed, not silently assumed? [Assumptions, Spec Assumptions — "Session duration is known (default 60 min, pending confirmation)"]
- [ ] CHK044 Is the dependency on spec 018's `subscriptions.current_period_end` being read-only (never mutated) stated as a hard constraint the extension mechanism must satisfy? [Dependencies, Spec FR-013 / Dependencies]

## Ambiguities & Conflicts

- [x] CHK045 Is the dangling "NFR-028" reference (research R-003) corrected to the intended FR number, with no remaining pointer to a non-existent requirement? [Ambiguity, RESOLVED 2026-06-16 — research.md R-003 now reads `FR-028` (the no-hardcoded-policy-values requirement the spec actually defines); no `NFR-028` remains. Verify: grep for `NFR-028` is clean.]
- [ ] CHK046 Is the `MAX(hourly_rate_usd)` aggregation in `run_monthly_payroll` reconciled with the snapshot model — i.e., is it stated/guaranteed that all rows for a teacher/month share one rate, so MAX cannot silently mask a mid-month rate change? [Ambiguity, data-model.md `run_monthly_payroll` vs FR-018 "adjustable per teacher"]
- [ ] CHK047 Is it unambiguous whether `attendance_records.session_id` (nullable) or `booking_id` (UNIQUE, NOT NULL) is the idempotency/identity anchor for finalization, given `session_id` is nullable? [Ambiguity, Spec FR-004 vs data-model.md]

## Notes

- Check items off as completed: `[x]`
- `[Gap]/[Ambiguity]/[Conflict]/[Assumption]` markers indicate items not directly traceable to a single clean requirement and signal a requirement-quality defect to resolve before build.
- Highest-risk items (money correctness + idempotency anchors): CHK001–CHK002, CHK011, CHK016, CHK021–CHK023, CHK046–CHK047.

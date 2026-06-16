# Specification Quality Checklist: Data Migration + Big-Bang Cutover

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.
- **Validation status**: PASSED with 3 open clarifications (the allowed maximum). Run `/speckit.clarify` to resolve before planning: (1) the fixed cutover **date/time** (absolute timestamp, pre-announced); (2) the legacy-**balance→entitlement conversion policy** (how remaining package credits/`student_credits` and mid-cycle remainders are valued); (3) the **rollback decision authority** (which named role invokes rollback and signs off the verification gates). None block the spec's shape; all three are bounded decisions, but #1 and #3 gate actually scheduling the cutover.
- 📖 **Quran-integrity is the load-bearing invariant**: hifz progress is merged-never-overwritten, exact `surah:ayah` preserved byte-for-byte, and the `student_progress_ayah_range_guard` is never bypassed (FR-003/FR-004/FR-005/NFR-001, reconciled by SC-001). Reviewers should treat any migration step that narrows, resets, overstates, or guesses memorized ayat — or disables the guard — as a CRITICAL defect.
- 🛠 **Cutover safety is procedural, not incremental**: big-bang means the safety comes from freeze + restore-verified backup + production-copy rehearsal + documented rollback with explicit trigger criteria (FR-012/FR-013/FR-014/FR-020/FR-021, SC-005/SC-008). The known prod `schema_migrations` reconciliation (~103 pre-baseline versions) is called out as the real deploy blocker (FR-015, SC-006) and the baseline is never `db push`ed.
- **Scope boundary is strict**: this spec only **moves existing data** and **runs the cutover event**. Every feature being migrated *onto* lives in its own spec (018 billing rails, 019 catalog/tiers, 020 scheduling/cohorts, 021 attendance/payroll, 022 single-sessions, 023 reports/notifications). Reviewers should reject any requirement here that designs or alters those features rather than migrating data into them.
- Stripe test→live is **keys/config only, no code change**, and **only after** verification passes (FR-018/FR-019, SC-007); USD-only, Stripe-only at go-live per plan decision #17.

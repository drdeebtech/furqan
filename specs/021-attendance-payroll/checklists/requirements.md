# Specification Quality Checklist: Attendance, Excuses & Teacher Payroll

**Purpose**: Validate specification completeness and quality before proceeding to planning.
**Created**: 2026-06-16
**Feature**: `/home/drdeeb/furqan/specs/021-attendance-payroll/spec.md`

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) in requirements — table/function names appear only in Assumptions/Dependencies/Key Entities as reuse references
- [x] Focused on user value and business needs (fairness to students, correct teacher pay)
- [x] Written for non-technical stakeholders (the three lenses are explicit)
- [x] All mandatory sections completed (Scenarios, Requirements, Success Criteria)

## Requirement Completeness

- [x] No more than 3 `[NEEDS CLARIFICATION]` markers remain (3 used: rate effective-dating, month-boundary timezone basis, exact subscription-extension mechanics)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined (Given/When/Then)
- [x] Edge cases are identified (boundary excuse timing, double-outcome, teacher+student absent, month boundary, missing rate, substitute attribution, canceling-subscription extension)
- [x] Scope is clearly bounded (in-scope vs each adjacent spec 018/019/020/022/023/024)
- [x] Dependencies and assumptions identified (esp. spec-018 subscription-period coupling and spec-020 substitute availability)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (unexcused/excused branch, excuse decision, extension, teacher absence, payroll)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation leakage into requirements

## Domain-Specific (furqan)

- [x] Money/credit logic reuses the hardened debit/restore kernel; no new financial primitive invented
- [x] Unexcused absence stays debited; excused carry-over restores exactly once (idempotent)
- [x] Financial/hour columns guarded; service-role-only writes; EXECUTE lockdown noted
- [x] RLS ships per table in the same migration; `( select auth.uid() )` initplan pattern
- [x] Local Postgres verification required for money/payout migrations (multi-cycle simulation)
- [x] Progress is merged, never overwritten/reset; Quran integrity unaffected
- [x] Arabic RTL rendering required for all new UI
- [x] Three lenses (engineer / Quran teacher / platform expert) named

## Notes

- Resolve the 3 `[NEEDS CLARIFICATION]` markers during `/speckit-clarify` before `/speckit-plan`:
  1. Teacher hourly-rate effective-dating (per-session rate vs. rate at month close).
  2. Timezone/boundary basis for "session delivered in month" at the payroll cutoff.
  3. Exact subscription/course-period extension mechanics and interaction with the Stripe current-period-end / cancel-at-period-end (coordinate with spec 018).

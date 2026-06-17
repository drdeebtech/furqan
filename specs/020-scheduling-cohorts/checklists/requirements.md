# Specification Quality Checklist: Scheduling, Fixed-Teacher Assignment & Cohorts

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (≤3 allowed; see Notes)
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

## Three-Lens Coverage (AGENTS.md §1)

- [x] 🛠 Engineer lens: reuse of existing scheduling tables, RLS-per-table, fail-closed booking, service-role boundaries asserted
- [x] 📖 Quran teacher lens: exact program/level handling per product; no fabricated Quran facts; continuity preserved
- [x] 🎓 Platform expert lens: learner UX for slot-pick / cohort-join, RTL/Arabic, teacher-lock fairness

## Scope Boundaries (cross-spec)

- [x] Billing/grants deferred to spec 018
- [x] Catalog/credits/proration deferred to spec 019
- [x] Attendance/absence/excuses/payroll deferred to spec 021
- [x] Single/instant/assessment sessions deferred to spec 022
- [x] Notification content/channels deferred to spec 023
- [x] Existing-user migration deferred to spec 024

## Notes

- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.
- The spec defines **scheduling only**: it creates bookings / cohort memberships; the actual session **debit** is owned by the existing kernel (`deduct_package_session`, `confirm_booking_with_session`, etc.) per specs 018/019 and is referenced, not redefined.
- Up to 3 `[NEEDS CLARIFICATION]` markers are permitted; resolve them in `/speckit.clarify` before planning.

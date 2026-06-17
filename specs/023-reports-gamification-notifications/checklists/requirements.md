# Specification Quality Checklist: Reports, Gamification & Notifications

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] [NEEDS CLARIFICATION] markers within limit (≤3; 3 present — certificate format, WhatsApp provider/templates, honor-board opt-out)
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

- [x] 🛠 Engineer lens: reuse of `notifications`/`automation_logs`/`emitEvent`/n8n intake; RLS-per-table in same migration; service-role-only writes for system artifacts; fail-closed delivery accounting
- [x] 📖 Quran teacher lens: every cited juz/surah:ayah read from canonical `src/lib/quran/`; no generated/hardcoded counts; tashkeel/waqf preserved; appreciation ≠ ijazah
- [x] 🎓 Platform expert lens: guardian progress visibility, earned/fair encouragement, full Arabic RTL across in-app/email/WhatsApp

## Scope Boundaries (cross-spec)

- [x] Billing/grants and event **emission** deferred to spec 018 (this spec consumes, never emits)
- [x] Course/product catalog + "next product" inventory deferred to spec 019
- [x] Scheduling/cohorts deferred to spec 020
- [x] Attendance/excuse **event sources** deferred to spec 021 (this spec consumes outcomes)
- [x] Single sessions deferred to spec 022
- [x] Migration/cutover deferred to spec 024
- [x] Ijazah/sanad (plan #39) explicitly deferred and NOT built here

## Reuse & Integrity Assertions

- [x] WhatsApp channel added by extending existing `notifications.channel` set (migration) without breaking existing rows
- [x] Idempotency via existing `automation_logs.idempotency_key` (status started/succeeded/failed/skipped)
- [x] Typed event names only (`FurqanEvent`/`Events`), no string literals (AGENTS.md §4)
- [x] New migrations land after `20260428000000_remote_baseline.sql`; baseline never `db push`ed
- [x] `npm run db:types` regen + `tsc`/`lint`/`test:unit` + clean `sb:advisors` required (FR-021)

## Notes

- Check items off as completed: `[x]`
- Three [NEEDS CLARIFICATION] markers are within the ≤3 limit and listed in the spec's "Clarifications Needed" section; resolve during `/speckit-clarify` before planning.

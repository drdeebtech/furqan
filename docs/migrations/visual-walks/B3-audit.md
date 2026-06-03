# B3 — Component Consolidation Audit

**Date:** 2026-05-06
**Auditor:** Claude (static analysis across `src/app/admin|teacher|student/**` + `src/components/shared/`)
**Scope:** Identify duplicated UI patterns across the 3 dashboards and propose consolidation order (note: `src/app/moderator/**` was deleted per ADR-0003 on 2026-05-08)
**Reference:** Phase B3 brief in `FURQAN_SESSION_MODES_MIGRATION_PLAN.md`

---

## TL;DR

The migration plan's B3 brief assumed dashboard components were largely inlined and needed extraction. **Reality: roughly half the candidate components already exist** under `src/components/shared/` — `stat-card.tsx`, `empty-state.tsx`, `widget-card.tsx`, `priority-chip.tsx`, `data-table.tsx`, `avatar.tsx`, `action-feedback.tsx`. The actual B3 work is **enforcing adoption** of the existing primitives, not extracting new ones.

This is a documentation-only PR. The real consolidation work belongs in incremental follow-up PRs after Stage 4 dashboards land (so the consolidation includes the new `SessionModeBadge`-using surfaces).

---

## Inventory of pattern occurrences

| Pattern | Hits | Existing primitive | Adoption gap |
|---|---|---|---|
| Stat-card-style (\`glass-card p-4\` with icon + label + value) | ~110 | `src/components/shared/stat-card.tsx` | partial — many dashboards still inline the pattern |
| Empty state (Inbox icon + "no X yet" copy) | ~37 | `src/components/shared/empty-state.tsx` | partial |
| Page header (`<h1 className="text-2xl font-bold">` + optional subtitle + actions) | ~74 | **none** — every page rolls its own | full extraction opportunity |
| Status pill (`glass-badge` with semantic color) | ~85 | `src/components/shared/priority-chip.tsx` is one variant; `session-status.tsx` is another; the new `SessionModeBadge` is a third | reorganize, don't dedupe |
| Form field (label + `glass-input` + error message) | ~190 | **none** — patterns are inline | full extraction opportunity |

**Net gap:** Page-header + form-field are the two genuinely-missing primitives. Stat-card and empty-state need adoption enforcement, not extraction.

---

## Existing shared components — already covering ground

From `src/components/shared/` (alphabetical):

| Component | Purpose | Health |
|---|---|---|
| `action-feedback.tsx` | Renders \`{ ok, message?, error? }\` from `loudAction` | ✅ canonical |
| `admin-list-skeleton.tsx` | Loading skeleton for admin tables | ✅ |
| `analytics-chart.tsx` + impl | Reusable chart wrapper | ✅ |
| `avatar.tsx` | Profile avatar with size variants | ✅ |
| `breakdown-bar.tsx` | Horizontal stacked bar for KPI splits | ✅ |
| `checkbox-group.tsx` | Picklist for CV form (used 3+ places) | ✅ |
| `data-table.tsx` | Generic table wrapper | ✅ |
| `empty-state.tsx` | Empty-state pattern | ⚠️ underused — 37 inlined patterns |
| `priority-chip.tsx` | Priority level pill | ✅ |
| `search-input.tsx` | Search input with icon | ✅ |
| `session-status.tsx` | Live/scheduled/ended pill | ✅ |
| `session-timer.tsx` | Live session countdown | ✅ |
| `skeleton.tsx` | Generic loading skeleton | ✅ |
| `stat-card.tsx` | Single stat with icon + label + value | ⚠️ underused — 110 inlined patterns |
| `toast.tsx` + `toast` provider | Notification toasts | ✅ |
| `widget-card.tsx` | Dashboard widget container | ✅ |

---

## Proposed B3 implementation order (NOT in this PR)

Follow-up PRs should land in this order to minimize merge conflicts and reviewer load:

### B3.1 — `<PageHeader>` extraction (highest leverage)
- Create `src/components/shared/page-header.tsx` matching the most-polished current implementation
- Migrate ~74 call sites in batches by role (admin first, then teacher, student)
- Pure refactor, visual output identical

### B3.2 — `<FormField>` extraction
- Create `src/components/shared/form-field.tsx` wrapping label + glass-input + ActionFeedback-style error
- Migrate ~190 call sites — biggest diff, do over multiple PRs by feature area
- Keep existing `glass-input` utility class as the inner primitive

### B3.3 — Adopt existing `<StatCard>` everywhere
- Replace ~110 inline stat-card patterns with `<StatCard>` from `src/components/shared/`
- May need to extend StatCard with variants (size, accent color) to match every existing usage
- Visual output identical

### B3.4 — Adopt existing `<EmptyState>` everywhere
- Replace ~37 inline empty-state patterns
- Same approach as StatCard: extend the primitive if needed, then migrate call sites

### B3.5 — Status-pill rationalization
- 85 pill usages span `priority-chip`, `session-status`, `glass-badge`, `SessionModeBadge`. Don't merge them into one — keep the *semantics* separate (priority vs status vs mode are different concepts).
- DO ensure each one consistently uses `.glass-badge` as the base utility (audit any inline `border + bg + rounded-full + px-2 py-0.5` patterns and migrate).

---

## Non-recommendations

The migration plan's B3 brief listed "ConfirmDialog" + "TabGroup" + "DateTimeDisplay" as candidates. After looking at the actual code:

- **Confirm dialogs** are mostly handled inline via window.confirm or contextual UX (e.g. action queue). A shared `<ConfirmDialog>` would actually be lower-fidelity than the current contextual treatments. **Don't extract.**
- **Tabs** are used in only 3-4 places, each with bespoke styling tied to its surrounding section. Premature consolidation. **Don't extract.**
- **Date/time formatting** is already centralized through `useLang().lang === "ar"` checks scattered across the code. A `<DateTimeDisplay>` wrapper would just hide the locale logic without simplifying it. **Lower priority.**

---

## Why this PR is documentation-only

- Stage 4 (#60) introduces \`SessionModeBadge\` — a new kind of pill that should be considered when the status-pill rationalization happens. Doing B3 before #60 merges means redoing the rationalization.
- B3 work spans 110 + 37 + 74 + 190 = ~411 call-site changes. Breaking those into 5+ smaller PRs (per the order above) is much safer than a single mega-PR.
- The audit doc itself is the immediate value: future reviewers can pick up B3 in increments without re-doing the analysis.

---

## What's not in this audit

- The 4 dashboards' specific UX gaps (those belong in the broader teacher/student/admin product audits, not in a component-consolidation pass)
- Mobile breakpoint coverage of the existing primitives — would need a live walk
- Accessibility audit of the existing primitives — separate workstream

End of audit.

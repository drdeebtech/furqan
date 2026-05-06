# B2 — Dashboard Liquid Glass Audit

**Date:** 2026-05-05
**Auditor:** Claude (static analysis, dark-mode dashboards as primary surface)
**Scope:** Dashboard glass treatment across `src/app/admin/*`, `src/app/teacher/*`, `src/app/student/*`, `src/app/moderator/*`, plus the canonical `src/styles/glass.css`
**Reference:** `.impeccable.md` ("gold-on-black Liquid Glass identity") + the migration plan's Phase B2 brief

---

## TL;DR

The migration plan's Phase B2 brief assumed the dashboards still had a "generic frosted glass" treatment that needed a corrective Apple-style pass. **Reality: the canonical `src/styles/glass.css` is already at v3 with intensified specular highlights, depth blur, multi-layer box-shadows, and hover-revealed streaks.** It implements the recipe the migration plan was about to add inline.

What B2 *should* do, given the current code state:

1. ✅ **Consolidate the inline `bg-white/5` table-header pattern** into a `.glass-thead` utility (10 inline usages across 9 admin tables) — done in this PR
2. ⚠️ **Keep light-mode flat treatment** — intentional design call (matches iOS Reminders / Books reference); not a parity gap
3. ⚠️ **Don't rebuild the v3 recipe** — already there

---

## Inventory of glass utilities (all defined in `src/styles/glass.css`)

| Utility | Purpose | Where used |
|---|---|---|
| `.glass-card` | Hero / primary panels (dashboards, settings panels) | ~150+ call sites |
| `.glass-card-lite` | List items, performance tier (less blur, less shadow) | ~20+ |
| `.glass` | Buttons, pills, interactive elements | ~150+ |
| `.glass-pill` | 9999px radius variant | ~80+ (paired with `.glass`) |
| `.glass-gold` | Primary CTA — gold-tinted glass | ~60+ |
| `.glass-danger` | Destructive actions | ~15 |
| `.glass-success` | Confirmation states | ~10 |
| `.glass-input` | Form inputs | ~40+ |
| `.glass-sidebar` | Full-height navigation panel | 4 (one per role layout) |
| `.glass-nav-item` | Sidebar / nav row | ~50+ |
| `.glass-row` | Table-row hover | ~5 |
| `.glass-badge` | Chips / tags | ~30+ |
| `.glass-modal` | Modals / dialogs | ~10 |
| **`.glass-thead`** | Table header tint (NEW) | **10 (this PR)** |

**Total canonical usages on dashboards: ~764** (per a quick grep). System adoption is high.

## What v3 already does (no need to redo)

Reading `src/styles/glass.css` in full reveals the system already implements every Apple-style cue the migration plan's Phase B2 brief was prescribing:

- ✅ **Translucent material** — `linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)`
- ✅ **Depth blur** — `backdrop-filter: blur(16-32px) saturate(180-200%)` per variant
- ✅ **Specular highlight at top edge** — `border-top-color: rgba(255,255,255,0.40)` plus `inset 0 1.5px 0 rgba(255,255,255,0.25)`
- ✅ **Outer shadow** — multi-layer `0 12px 48px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3)`
- ✅ **Inner edge highlight** — `inset 0 1.5px 0 rgba(255,255,255,0.25)`
- ✅ **Specular streak (the "tilting glass" effect)** — `::before` pseudo with `linear-gradient(105deg, ...)` revealed only on hover (a deliberate restraint; permanent streaks were noisy on dense grids per the v3 comment)
- ✅ **RTL mirror** — `[dir="rtl"] .glass-card::before { background: linear-gradient(255deg, ...) }` flips the streak angle
- ✅ **Reduced-motion** + **backdrop-filter fallback** for older browsers / accessibility

**The v3 recipe is the recommended recipe.** Phase B2's prescription to add a custom `<LiquidSurface>` component with hardcoded gradient tokens would have been re-implementation of work that already exists.

## What's actually inconsistent (the real B2 gap)

A grep across all dashboards turned up two patterns that bypass the canonical utilities:

### 1. Table header inline tint (FIXED in this PR)

Pattern: `<tr className="border-b border-white/10 bg-white/5">` repeated in 9 admin table files (10 occurrences). This was the single highest-frequency inline glass-bypass on dashboards.

Migrated to a new `.glass-thead` utility:

```css
.glass-thead {
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}
.light .glass-thead {
  background: rgba(0, 0, 0, 0.025);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
```

### 2. Other inline `bg-white/5` (not migrated — context-specific)

Remaining inline `bg-white/N` usages across admin/student/teacher fall into legitimate categories:

- **Course cards** (`src/app/admin/courses/page.tsx`, `[id]/page.tsx`): use `bg-white/30 dark:bg-white/5` for a hover-state list item. This is **dual-mode aware** (light + dark) and isn't a glass surface — it's a tint. Leave as-is.
- **Teacher availability disabled state** (`src/app/admin/teachers/[id]/availability-editor.tsx:235`): muted "off" tile — explicit non-interactive style, keep.
- **Timeline tab pills** (`src/app/admin/users/[id]/timeline/timeline-client.tsx`): tabs already use `glass-pill` + a neutral `bg-white/10` hover — that's an `.glass:hover` mismatch but acceptable; full migration to `.glass` would change behavior.

**Decision: don't touch these in B2.** Each has a justified non-canonical reason. A future B3 component-consolidation pass could extract them into shared primitives.

### 3. Inline `backdrop-blur` overlays (not migrated — different purpose)

The 5 `backdrop-blur` usages in dashboards are on:

- Modal backdrops (n8n execution detail) — should arguably move to `.glass-modal` but the current code uses a separate fullscreen overlay, not a card
- Sticky bulk-action bar (admin/bookings) — explicit floating affordance with gold border
- N8N overview-tab sticky section header (legitimate sticky-header tint)
- "Acting as user" admin banner (sticky top warning)
- Keyboard shortcuts-help overlay backdrop

These are overlays, not "glass surfaces" in the design-system sense. Leaving them alone.

## Recommendation for downstream B2 work

1. ✅ `.glass-thead` consolidation — shipped in this PR
2. **Defer to B3** — consolidate the timeline-pill / course-card / teacher-disabled-tile patterns into a shared component when B3 (component consolidation) runs
3. **No changes to the v3 recipe** — the system is already where the migration plan wanted it
4. **Light mode is intentionally flat** — keeps reference parity with iOS Reminders / Books per `.impeccable.md`. If a future "liquid-light" treatment is desired (e.g. translucent panels over a soft cream background), that's a deliberate new design direction, not a B2 bug fix

## What's not in this audit

- Live-walk verification of the 4 dashboard pages — would need authenticated browser sessions for admin / teacher / student / moderator. The static analysis is sufficient for the canonical-utility audit; live walks belong in B2 Gate 3 (verification) once a reviewer has the preview URL.
- Performance profiling under scroll — `prefers-reduced-motion` already disables blur, so the worst-case is bounded.
- Accessibility / contrast pass — `glass-input` already includes `:focus-visible { outline: 2px solid var(--gold) }` which covers WCAG 2.4.7. A broader a11y pass is a separate workstream.

End of audit.

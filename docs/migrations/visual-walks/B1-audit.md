# B1 — Marketing Site Visual Audit

**Date:** 2026-05-05
**Auditor:** Claude (in-Chrome, logged-out visitor session)
**Scope:** All public-facing nav links on furqan.today as a logged-out visitor, desktop viewport
**Reference:** `.impeccable.md`, `CLAUDE.md` Universal Rules, `FURQAN_SESSION_MODES_MIGRATION_PLAN.md` Phase B1 criteria

---

## TL;DR — Top 10 P0/P1 Issues, Recommended Order of Fix

| # | Severity | Issue | File / Surface | Estimated effort |
|---|---|---|---|---|
| 1 | **P0** | `/teachers` returns 404 to logged-out visitors despite link in top nav | route missing under `src/app/(public)/teachers/` | 2–4 h (build the page) |
| 2 | **P0** | `/teach-with-us` returns 404 to logged-out visitors despite link in top nav | route missing under `src/app/(public)/teach-with-us/` | 2–4 h |
| 3 | **P0** | Arabic language toggle did not visibly flip homepage to RTL/Arabic on click | `src/lib/i18n/lang-toggle.tsx` (or wherever toggle lives) | 1–3 h (debug; could be content gap rather than logic) |
| 4 | **P1** | Decorative gold (#B8922D) used heavily on non-interactive elements — violates Universal Rule #5 | global; ~6 distinct surfaces enumerated below | 2–4 h |
| 5 | **P1** | Public site is light-cream-themed; CLAUDE.md / `.impeccable.md` says canonical background is `#0a0a0a` (dark) — drift or intentional? | global; needs design decision then implementation | 30 min (decision) + 4–8 h (if changing) |
| 6 | **P1** | WhatsApp Number placeholder on `/contact` form is `+44 7400 000000` (UK) — wrong for a Kuwait-based MENA academy | `src/app/(public)/contact/page.tsx` | 5 min |
| 7 | **P1** | Top header strip ("📞 +965 9779 5626" left, "alforqan.egy@gmail.com" right) is unstyled and feels unrelated to the rest of the layout | `src/components/public/public-nav.tsx` (or layout) | 1–2 h |
| 8 | **P1** | Logged-in `/` redirect: visiting furqan.today as a logged-in teacher routes to `/teacher/dashboard`, not the marketing site. No way for an authenticated user to view marketing content (e.g., to share a link). | route guard logic | 1 h (decide policy + add `?marketing=1` escape or `/home` alias) |
| 9 | **P1** | Vercel toolbar widget (orange "S" icon, top-right) appears to leak to public users — verify it's only visible to my session and not all visitors | `next.config.ts` Vercel toolbar config | 15 min verification |
| 10 | **P1** | "9 nav items" reality contradicts the migration plan's "public 7-page site" — plan must update or `/courses` and `/teach-with-us` need a public spec | `FURQAN_SESSION_MODES_MIGRATION_PLAN.md` Universal Rule #1 | doc fix |

After P0/P1: 4 P2 polish items below.

---

## Verification methodology

- Logged out from the existing teacher session (`Mohamed Farag`).
- Navigated through every nav link in the public top bar in order.
- Captured screenshots + console messages per page.
- Tested language toggle (one click) and 380px viewport (one resize).
- All consoles clean except a benign Chrome-extension warning (`Using DEFAULT root logger`) and one extension async-listener exception on `/teachers` — neither originates from FURQAN code.

---

## Per-page findings

### `/` — Homepage

**State:** loads, console clean.
**Hero:** small pill ("Online Quran Learning Academy" — gold text on neutral pill) → centered logo → bold serif title "Learn **Quran** With Expert Teachers" (gold "Quran" word) → muted subtitle with bullet separators → gold "Register Now" CTA + "Explore our services →" link.

| Criterion | Status | Notes |
|---|---|---|
| A. Typography | ✅ | Strong hierarchy, generous serif headline, comfortable line-height |
| B. Spacing | ✅ | Centered hero with breathing room |
| C. Color usage | ⚠️ | Gold "Quran" word and "Online Quran Learning Academy" pill text are decorative — Rule #5 violation candidates |
| D. Imagery | ✅ | Custom logo crest is on-brand |
| E. Micro-interactions | ⚠️ | Hover states not tested |
| F. RTL correctness | ⚠️ | Could not verify — toggle didn't flip |
| G. Mobile | ⚠️ | Not verified — `resize_window` didn't take effect |

### `/about` — About Us

**State:** loads, console clean.
**Hero:** breadcrumb (Home / About) → "About Us" title → subtitle. Stat cards on right: 24/7, Ijazah, then 1:1, Free below the fold.

| Criterion | Status | Notes |
|---|---|---|
| C. Color usage | ⚠️ | Stat-card numbers (24/7, Ijazah) are gold and non-interactive — Rule #5 violation. ❖ "Our Story" eyebrow gold-glyph also decorative |
| Layout | ✅ | Title on left, supporting cards on right — good rhythm |

### `/services` — Our Services

**State:** loads, console clean.
**Hero:** same breadcrumb pattern. Body has section eyebrow ("❖ Quran Memorization (Hifz)") + custom illustrated card on right (child reading, "Alforqan" branded mushaf-shelf graphic).

| Criterion | Status | Notes |
|---|---|---|
| Imagery | ✅ | Custom illustration is the strongest single visual on the public site |
| C. Color usage | ⚠️ | Same ❖ eyebrow glyph in gold, decorative |

### `/packages` — Our Packages

**State:** loads, console clean.
**Hero:** breadcrumb → "Our Packages" → "Start with a free trial, then pick the plan that fits your schedule." Below: "LAUNCH PHASE" pill + "Platform access is **free during launch**" headline + gold "Start now" CTA.

| Criterion | Status | Notes |
|---|---|---|
| C. Color usage | ⚠️ | "LAUNCH PHASE" pill text is gold (decorative). "free during launch" inline emphasis is gold (decorative — though arguably it's *messaging emphasis* which is the spirit of "interactive"-ish). "Start now" CTA gold — interactive ✅ |
| Messaging | ✅ | Honest framing about pricing being for reference |

### `/courses` — Recorded Courses

**State:** loads, console clean. Empty state ("No published courses yet").
**Filter pills:** All / Tajweed / Hifz / Ijazah / Arabic separator All / Free / Paid. The selected pills ("All" both groups) use gold backgrounds — interactive, **correct use of gold ✅**.

| Criterion | Status | Notes |
|---|---|---|
| Empty state | ⚠️ | Bare tray icon + "No published courses yet" — could be more inviting (e.g., "Recorded courses launching soon — meanwhile, see [Live Sessions →](/services)") |
| Filter design | ✅ | Pills are clean, dual-axis (topic / pricing) is well-organized |

### `/teachers` — **404**

**State:** ❌ **Returns 404 page.** Beautiful Arabic 404 design (Arabic numerals "٤٠٤" + bilingual "الصفحة غير موجودة / The page you're looking for can't be found" + "تواصل معنا" + gold "العودة للرئيسية · Back home" CTA + gold-styled Quranic quote at bottom).

The page itself is well-designed; the bug is that `/teachers` is a top-nav link with no public route to support it. Suspected cause: route only exists under `/student/teachers` for authenticated students.

**Fix priority: P0.** Either build a public `/teachers` page (browse-teachers experience for prospective students) or remove the link from the public nav.

### `/blog` — Blog

**State:** loads, console clean. "6 Articles" subtitle.
**First article above fold:** "Hifz" gray pill, "How to Start Your Quran Memorization Journey", lede paragraph, date + read time + gold "Read More ←" link.

| Criterion | Status | Notes |
|---|---|---|
| List density | ⚠️ | Only 1 article visible above the fold despite 6 total — vertical rhythm too generous; consider tighter card spacing or a 2-column grid above ~1024px |
| Card | ✅ | Hifz pill is neutral gray (no decorative gold) — good restraint |

### `/contact` — Contact Us

**State:** loads, console clean.
**Layout:** two-column. Left: "❖ Get in Touch" eyebrow + "We'd Love to Hear from You" + WhatsApp number + Email. Right: "Send us a Message" form (Full Name / Email / WhatsApp Number).

| Criterion | Status | Notes |
|---|---|---|
| Form placeholder | ⚠️ | WhatsApp Number placeholder is `+44 7400 000000` (UK format). Wrong for a Kuwait/MENA academy. Should be `+965 …` or generic `+9xx ……` |
| Layout | ✅ | Two-column rhythm works |
| C. Color usage | ⚠️ | ❖ eyebrow gold (same pattern as elsewhere) |

### `/teach-with-us` — **404**

**State:** ❌ **Returns 404 page.** Same as `/teachers` — link in top nav, no public route exists.

**Fix priority: P0.** This is presumably "join us as a teacher" recruiting content — high-leverage page for academy growth. Build it or remove the link.

---

## Decorative-gold inventory (Universal Rule #5 violations)

Per `.impeccable.md`: **Gold #B8922D ONLY on interactive elements.**

| Surface | File | Decorative use? |
|---|---|---|
| "Quran" word in homepage hero | `src/app/(public)/page.tsx` | Decorative — emphasizing the brand word |
| "Online Quran Learning Academy" pill text on `/` | `src/app/(public)/page.tsx` | Decorative — section pill |
| Stat-card numbers (24/7, Ijazah, etc.) on `/about` | `src/app/(public)/about/page.tsx` | Decorative — non-interactive figures |
| ❖ diamond glyph in section eyebrows on `/about`, `/services`, `/contact`, `/packages` | shared eyebrow component | Decorative — pure ornament |
| "LAUNCH PHASE" pill text on `/packages` | `src/app/(public)/packages/page.tsx` | Decorative — section pill |
| "free during launch" emphasis text on `/packages` | `src/app/(public)/packages/page.tsx` | Borderline — messaging emphasis, not interactive |
| Quranic quote text on the 404 page | shared 404 layout | Decorative — but feels mission-aligned |

**Recommendation:** before mass-removing gold, get the user's read on which of these are *brand exceptions*. Ornamental gold on the brand word "Quran" and the Quranic quote are arguably part of the academy's visual identity and worth keeping. The stat-card numbers and pill texts are the clearer violations.

---

## Cross-cutting issues

### Theme drift — public site is light, dashboard is dark

CLAUDE.md says canonical background is `#0a0a0a` (dark). The public site is on a cream/warm-light surface. The dashboard (which I briefly saw before logging out) is light too — so the project may have drifted from the dark default entirely, or the dark theme is opt-in via the moon-icon toggle visible in the top-right.

This is a **Phase B1 vs B2 boundary question**: if the public site is intentionally light and dashboards intentionally dark, B1 polishes the light side, B2 polishes the dark side. If they're meant to be the same, that's a much bigger decision.

### Bilingual flip — toggle did not visibly switch

Clicking the "عربي" toggle from the logged-out homepage (one click at the toggle's coordinates) did not flip the page to Arabic. The toggle visually became active (gold underline appeared) but the nav items, hero copy, and CTAs remained English.

Possible causes:
- Click missed the toggle hotzone (lower priority — UI showed an active state, suggesting the click registered)
- The toggle stores the preference but only flips on the next navigation
- Public-site Arabic content is not wired through `t()` for some/all strings, so toggle is a no-op for visitors
- The toggle requires a page reload that didn't happen in 2s

**Recommendation:** manually click the toggle in your own browser, navigate to /about, and confirm whether RTL flips. If it doesn't, this is a **P0** real bug.

### `/` redirect for authenticated users

Logged in as the test teacher, `https://www.furqan.today/` routed to `/teacher/dashboard`. There's no way for a logged-in user to view the marketing site (e.g., to copy a link to share, or to preview B1 changes after this audit). Recommend: add `/home` or `?marketing=1` escape, or limit the redirect to only the unauthenticated case for `/`.

---

## P2 — Polish (not blocking ship of B1)

11. **Hero pattern inconsistency:** 6 of 7 pages use `breadcrumb → big serif title → muted subtitle`. The homepage uses `eyebrow pill → logo crest → big serif title`. Slight inconsistency — fine if intentional ("homepage is special").
12. **Login page bilingual redundancy:** "الدخول بحساب جوجل · Continue with Google" duplicates the same idea in both languages on one button — visually crowded. Either show one based on toggle, or use a smaller English secondary line.
13. **Top header strip:** "📞 +965 9779 5626" left + "alforqan.egy@gmail.com" right is a flat tan bar that feels like a placeholder. Consider integrating into the main nav as icons, or styling it as a clearly defined utility strip.
14. **Vercel toolbar leak (verify):** The orange "S" icon at top-right that's been on every screenshot looks like the Vercel Comment toolbar. If logged-in Vercel users see this, fine. If public visitors see it, it should be hidden in production.

---

## What was *not* verified in this pass

- **Mobile (380px):** `resize_window` returned success but the viewport stayed at desktop. Need a manual mobile check.
- **Dark mode:** moon icon toggle was not exercised.
- **Hover / interaction states:** mouseover on cards / buttons not tested.
- **Page-load performance / CLS:** no Lighthouse run.
- **All bilingual content:** only the toggle was clicked once on `/`. Per-page Arabic versions need verification.
- **Below-the-fold sections** on every page — only the first viewport was screenshotted per page. Long pages may have additional issues (testimonials, CTAs, footer).
- **Footer:** not screenshotted on any page.

These are reasonable Phase B1 Gate 3 (verification) concerns rather than Gate 1 (audit) blockers.

---

## Recommended fix order

1. **Decide on `/teachers` and `/teach-with-us` first.** Either build them or remove from nav. Both are high-leverage growth pages that shouldn't be 404s.
2. **Verify Arabic toggle.** If broken, this is a release-blocking bug for an Arabic-first academy.
3. **Decide on dark vs. light theme for public site** before any color cleanup work — otherwise gold cleanup gets redone.
4. **Quick wins (sub-30-min each):** WhatsApp placeholder, Vercel toolbar verification, top header strip styling.
5. **Decorative gold cleanup** (after theme decision).
6. **Below-the-fold + mobile + dark-mode pass** — runs as Phase B1 Gate 2 verification work.

---

## Files most likely to change in B1 implementation

- `src/components/public/public-nav.tsx` — top nav (decide nav items, top utility strip styling)
- `src/app/(public)/layout.tsx` — public layout, theme decision
- `src/app/(public)/page.tsx` — homepage hero, decorative gold
- `src/app/(public)/about/page.tsx` — stat-card gold numbers, ❖ eyebrows
- `src/app/(public)/services/page.tsx` — ❖ eyebrows
- `src/app/(public)/packages/page.tsx` — pill + emphasis gold
- `src/app/(public)/contact/page.tsx` — placeholder fix, ❖ eyebrow
- `src/app/(public)/teachers/page.tsx` — **does not exist; create**
- `src/app/(public)/teach-with-us/page.tsx` — **does not exist; create**
- `src/components/public/section-eyebrow.tsx` (or similar shared) — ❖ glyph color decision
- `src/lib/i18n/lang-toggle.tsx` — verify toggle wiring
- `next.config.ts` — Vercel toolbar visibility for prod

---

## Output of this audit

This file replaces the 200-line "Paste this into Claude in Chrome" prompt block in the migration plan's Phase B1 Gate 1. The next step (Gate 2: Implementation) should pick from the Top-10 ranked list above, *not* from the unranked free-text criteria the migration plan specifies.

End of audit.

# FURQAN Academy — Design Instructions for Copilot

> Canonical design context lives in `.impeccable.md` at the repo root. This file is a synced summary; if anything conflicts, `.impeccable.md` wins.

## Brand

FURQAN is an online Quran academy serving **all ages, all people** — children memorizing their first juz' alongside hāfiz preparing for ijāzah. Personality: **Premium · Refined · Authentic**. Apple-grade finish applied to a religious context: intentional materials, restrained color, tasteful Arabic typography. Dark theme is the canonical identity (gold-on-black "Liquid Glass"); light theme adopts the airy reference grammar where it fits (lavender body, white app-shell, blue brand recolor on student dashboard). RTL Arabic-first, bilingual.

**Voice:** Warm but grave. Encouraging without cheerleading. Speaks of the Quran with the dignity it deserves — never breezy, never preachy.

**Anti-references (explicit):** No generic LMS / corporate-training look. No childish or cartoonish styling. No aggressive marketing or SaaS conversion patterns (pop-up upsells, FOMO timers, gradient-everything CTAs). No human-face stock photography in religious contexts.

**References (blend):** Tarteel/Muslim Pro/Ayat (Quran apps — reverent typography), Apple iOS Reminders/Books (premium glass, gentle motion), Linear/Notion (cool minimal SaaS density), Khan Academy/Coursera (visible progress + warmth without mascots).

## Design Principles

1. **Clarity over cleverness** — Every element must be immediately understandable. Arabic labels first, English hints second.
2. **Progress is visible — quietly** — Stats and progress are prominent but never gamified. No streak fireworks, no "Level up!" toasts. The number ticks up; the work continues.
3. **Gold means action** — Gold (`#C8A652` dark / `#B8922D` light) is reserved for interactive elements only. Skin variants substitute their own accent (e.g. blue `#3B82F6` on student-dashboard-skin) following the same rule.
4. **Respect the content** — Quran references, surah names, and recitation terminology must be presented with typographic care. Always show Arabic names for session types and recitation standards. Never illustrate worship with stock photography.
5. **Motion with purpose** — Every animation has a reason. Respect `prefers-reduced-motion`.
6. **Accessible by default** — High contrast, WCAG 2.5.5 AAA touch targets (≥44px), visible focus rings, full RTL support.
7. **Restraint as a feature** — When in doubt, remove. One CTA per surface. Whitespace is silence around the work — not empty space. The reference for "is this too much?" is a well-bound mushaf, not a SaaS landing page.

## Design Tokens (Dark — default)

- Background: `#0F0F0F` | Foreground: `#F5F0E8` | Gold: `#C8A652` | Gold Hover: `#B8963E`
- Surface: `#1A1A1A` | Surface Border: `#2A2A2A` | Muted: `#9C9488`
- Card: `#1A1A1A` | Card Border: `#2A2A2A`
- Input: `#181818` | Input Border: `#333333` | Focus Ring: `#C8A652`
- Error: `#E05555` | Success: `#4CAF7D` | Warning: `#E0A830`

## Typography

- **Display/headings:** Amiri (`--font-display`) — Arabic serif
- **Body:** Cairo (`--font-body`) — clean Arabic+Latin sans-serif

## Component Patterns

- **Button:** `rounded bg-gold px-4 py-2 text-sm font-medium text-white neu-btn`
- **CTA:** `rounded-full bg-primary px-8 py-3 text-lg font-semibold text-white neu-btn animate-pulse-slow`
- **Card:** `rounded-2xl border border-card-border bg-card p-6`
- **Input:** `w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5`
- **Badge (gold):** `rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-gold`
- **Error:** `rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error`
- **Decorative:** `islamic-pattern` (SVG bg), `gold-line` (divider), `ornament-divider` (section break)
- **Elevation:** `elevation-1` to `elevation-4` for depth on dark surfaces

## Tech Stack

Next.js 16 App Router, Tailwind 4, React 19, Supabase, TypeScript. Use `dir="rtl"` on page containers. Email/password inputs use `dir="ltr"`. Server Components by default; Client Components only for interactivity. Icons: Lucide React.

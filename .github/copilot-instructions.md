# FURQAN Academy — Design Instructions for Copilot

## Brand

FURQAN is an online Quran academy for the global Muslim diaspora. Personality: Friendly, Accessible, Simple. Dark theme with gold accents. RTL Arabic-first, bilingual (Arabic primary, English secondary).

## Design Principles

1. **Clarity over cleverness** — Every element must be immediately understandable. Arabic labels first, English hints second.
2. **Progress is visible** — Stats, session counts, and quality ratings should be prominent. Motivation comes from visible progress.
3. **Gold means action** — Gold (`#D4AF37`) is reserved for interactive elements only: buttons, links, active states, focus rings.
4. **Respect the content** — Quran references, surah names, and recitation terminology must be presented with care. Always show Arabic names for session types and recitation standards.
5. **Accessible by default** — High contrast, large touch targets, no motion-dependent interactions, screen-reader-friendly labels.

## Design Tokens

- Background: `#0a0a0a` | Foreground: `#ededed` | Gold: `#D4AF37`
- Card: `#141414` | Card Border: `#1f1f1f` | Muted: `#888888`
- Input: `#1a1a1a` | Input Border: `#2a2a2a` | Error: `#ef4444` | Success: `#22c55e`

## Component Patterns

- **Button:** `bg-gold text-black font-semibold rounded-lg py-2.5 hover:bg-gold-hover`
- **Card:** `rounded-xl border border-card-border bg-card p-5`
- **Input:** `rounded-lg border border-input-border bg-input px-4 py-2.5 focus:border-input-focus focus:ring-1 focus:ring-input-focus`
- **Badge (gold):** `rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold`
- **Error:** `rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error`

## Tech Stack

Next.js 16 App Router, Tailwind 4, React 19, Supabase, TypeScript. Use `dir="rtl"` on page containers. Email/password inputs use `dir="ltr"`. Server Components by default; Client Components only for interactivity.

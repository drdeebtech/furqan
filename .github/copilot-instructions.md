# FURQAN Academy — Design Instructions for Copilot

## Brand

FURQAN is an online Quran academy for the global Muslim diaspora. Personality: Friendly, Accessible, Simple. Dark theme (with light + auto modes planned) featuring gold accents and subtle Islamic geometric patterns. RTL Arabic-first, bilingual (Arabic primary, English secondary).

## Design Principles

1. **Clarity over cleverness** — Every element must be immediately understandable. Arabic labels first, English hints second.
2. **Progress is visible** — Stats, session counts, and quality ratings should be prominent. Motivation comes from visible progress.
3. **Gold means action** — Gold (`#C8A652`) is reserved for interactive elements only: buttons, links, active states, focus rings.
4. **Respect the content** — Quran references, surah names, and recitation terminology must be presented with care. Always show Arabic names for session types and recitation standards.
5. **Motion with purpose** — Shimmer on stats, pulse on CTAs, slide-in toasts, press feedback on buttons. Every animation has a reason. Respect `prefers-reduced-motion`.
6. **Accessible by default** — High contrast, large touch targets, visible focus rings, screen-reader-friendly labels. WCAG AA minimum.

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

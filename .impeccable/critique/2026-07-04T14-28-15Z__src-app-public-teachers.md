---
target: the teacher marketplace (public teacher discovery)
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-07-04T14-28-15Z
slug: src-app-public-teachers
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong: "Searching…", skeleton, `aria-busy`, live result count, retry state, `page/totalPages`. Gap: `scroll:false` on page change leaves the user mid-scroll after "Next". |
| 2 | Match System / Real World | 2 | Bilingual + gender framing land well, but pagination chevrons are hardcoded (ChevronRight=Prev) — correct in Arabic RTL, **backwards in English LTR**. |
| 3 | User Control and Freedom | 3 | Clear-filters, Retry, breadcrumb, clear-in-empty-state all present. No undo needed. |
| 4 | Consistency and Standards | 3 | Glass system consistent; chevron direction and Latin-only contact param break it at the edges. |
| 5 | Error Prevention | 2 | Price min/max have no cross-validation — min>max silently yields "no results" with no cause. |
| 6 | Recognition Rather Than Recall | 3 | Filters visible (desktop), labels on every control and icon; "Ijazah in riwayah" is undefined jargon. |
| 7 | Flexibility and Efficiency | 2 | URL-state is shareable/deep-linkable, search debounced — good. No sort control, no keyboard path, no way to reorder results. |
| 8 | Aesthetic and Minimalist Design | 2 | Uniform 3-col identical glass-card grid, ~11 stacked info rows per card, zero hierarchy between a 500-session veteran and a brand-new teacher. |
| 9 | Error Recovery | 3 | Plain-language fetch-fail state + Retry; helpful empty state with apply-to-join CTA. |
| 10 | Help and Documentation | 2 | Trust-row explains value, but no inline definition of "Ijazah"/"riwayah", no filter help, no FAQ hook. |
| **Total** | | **25/40** | **Acceptable — significant improvements needed before a hesitant parent is happy** |

## Anti-Patterns Verdict

**Does this look AI-generated?** Not in the code — the engineering is genuinely careful (honest rating-gating at ≥3 reviews, RTL-aware `me-1`/`ps-9`, AbortController cleanup, real cache-tag reasoning). But **visually the card grid is the most template-shaped element on the page** and it collides with two explicit bans.

**LLM assessment:**
- **Identical card grid (DESIGN cross-register ban / PRODUCT anti-reference "identical card grids").** Twelve visually identical glass cards in a flat `md:grid-cols-2 lg:grid-cols-3`. Every card carries equal visual weight regardless of teacher quality. This is exactly the "Visual Noise Floor" — nothing stands out, so the parent has to read all twelve in full.
- **Trust-signal icon row (content.tsx:164–174)** — Award/GraduationCap/Star each as `icon + label` is one step from the banned "identical icon-heading-text" template. It survives only because it's a 3-item horizontal strip, not a card grid.
- **Personality that lifts it above slop:** gold-on-near-black, Rakkas display `font-display`, Arabic-first copy, the subtle `islamic-pattern` tile at 0.04 opacity. A visitor would ask "which platform is this?" not "which AI made this?" — so it passes the slop test, but the card grid undercuts the "designed, not templated" North Star.

**Deterministic scan:** `detect.mjs --json 'src/app/(public)/teachers'` returned `[]` (exit 0) — **zero automated findings**. No gradient text, no side-stripe borders, no glassmorphism-as-default flags. Clean. Every issue below is a judgment/brand/behavioral finding the linter cannot see.

**Visual overlays:** none — no dev server and no browser tool available (degraded run). No user-visible overlay was produced.

## Overall Impression

This is a competently built, honest marketplace that undersells itself. The code respects the brand's integrity principle better than most surfaces (it hides ratings until they're real, ranks veterans above one-review newcomers, filters test accounts). But two things hold it at "acceptable": **(1) there is no teacher profile page** — a vetting parent's entire decision rests on a 100-character truncated bio and a row of badges, then a button that dumps them into a generic contact form; and **(2) the card grid has no hierarchy**, so trust is spread thin across twelve equal tiles instead of concentrated. The single biggest opportunity: give each teacher a real page and give the strongest teachers visual primacy.

## What's Working

1. **Honest-by-construction data (content.tsx:308, page.tsx:104–115).** Rating stars appear only at ≥3 reviews, and ranking gates the same way so a lone 5★ can't float a newcomer above a 4.8-veteran. This is the "Exactness is the aesthetic" principle expressed in code, not copy. Rare and correct.
2. **System-status discipline (content.tsx:196–214).** `aria-live="polite"`, `aria-busy`, a real skeleton, a distinct fetch-fail state with plain-language Retry, and a separate empty state. The loading/error/empty triad is fully handled — most marketplaces ship one of the three.
3. **Genuine bilingual care.** `dir="auto"` on search, `ps-9/pe-4` logical properties, Arabic name preference (`pickDisplayName`), gender framing "للأخوات والأطفال / Sisters & children". RTL is first-class here, not bolted on.

## Priority Issues

### [P1] No public teacher profile — the trust decision has nowhere to land
- **Why it matters:** `(public)/teachers/` contains only `page.tsx` + `content.tsx`; the only `[teacherId]` route lives under auth-gated `student/teachers/`. A vetting parent (the primary audience per PRODUCT.md) gets a bio truncated at 100 chars (`displayBio.slice(0, 100)`), a few badges, and then "Book with this Teacher" → `/contact?teacher=<name>` — a generic contact form, not a booking flow or a teacher page. There is no way to read the full bio, see credentials in depth, or hear a sample before committing. This is the platform's core conversion moment and it dead-ends.
- **Fix:** Add `(public)/teachers/[teacherId]/page.tsx` — full bio, all recitation credentials, session count, gender note, languages, and a real book CTA. Make the card's name/avatar link to it. Feed the same data into `Person` JSON-LD per profile (the ItemList is already there).
- **Suggested command:** `/impeccable shape`

### [P1] Blanket credential claims stated as universal fact, above the fold
- **Why it matters:** The trust row (content.tsx:164–174) asserts "حاصلون على الإجازة / Certified with Ijazah" and "خريجو أفضل الجامعات الإسلامية / Top Islamic University Graduates" as flat facts about **every** teacher, before a single teacher is shown — yet the page's own metadata says "منهم خريجو الأزهر" (*some* are Azhar graduates). PRODUCT principle #2: "Never let the UI imply more than is true." A parent who books expecting an Azhar graduate and gets otherwise is exactly the honesty failure the brand is built to avoid. (Quran-teacher + trust lens.)
- **Fix:** Soften to honest scope ("معلمون بإجازات مُدقَّقة / Verified Ijazah credentials", "منهم خريجو الأزهر / including Al-Azhar graduates"), and let each card's own badges carry the specific claim. Truth per teacher, not a universal banner.
- **Suggested command:** `/impeccable clarify`

### [P2] Uniform card grid with no hierarchy — trust spread thin
- **Why it matters:** Twelve identical tiles, equal weight (content.tsx:243–351). A 500-session Ijazah-holder and a zero-session "New teacher" look the same size and shape. The parent must fully parse ~11 info rows × 12 cards. This is the banned "identical card grid" and the "Visual Noise Floor" cognitive-load violation at once. Worse: the strongest signal (many sessions, high rating) gets no visual amplification, while "New teacher" is drawn in **gold** — the brand's attention colour spent on the *weakest* signal.
- **Fix:** Introduce hierarchy — a larger "featured"/top-ranked treatment for the first 1–3, condense the rest; move the rating and session count into a prominent stat, demote languages/availability into a quieter tier; stop rendering "New teacher" in gold.
- **Suggested command:** `/impeccable layout`

### [P2] Pagination chevrons ignore reading direction
- **Why it matters:** content.tsx:365/379 hardcode ChevronRight for "Previous" and ChevronLeft for "Next". Correct in Arabic RTL, **reversed in English LTR** — an English user sees a left-arrow labelled "Next". Direct violation of the Bilingual-First Rule ("A font or size — and here, an icon — that only works for one script is not shipped").
- **Fix:** Swap chevrons on `lang`/`dir`, or use direction-neutral `ChevronStart`/`ChevronEnd` logical icons.
- **Suggested command:** `/impeccable polish`

### [P2] Per-card overload; no sort; price filter has no min≤max guard
- **Why it matters:** Each card stacks avatar, name, bio, gender note, specialty badges, riwayah badges, session count, rating, languages, availability, price, price caption, book button — 8+ decision points, past Miller's working-memory limit, with weak grouping (everything separated only by `mt-2`/`mt-3`). Results are server-sorted but the user can't choose (price/experience), and entering price min>max (filter-bar.tsx) silently returns an empty grid with no explanation.
- **Fix:** Chunk the card into ≤4 visual groups (identity / credentials / proof / price+CTA); add a sort control; clamp or warn when price min>max.
- **Suggested command:** `/impeccable distill`

## Persona Red Flags

**Jordan (Confused First-Timer):** "Ijazah in riwayah" and the recitation-standard badges (Hafs, Warsh…) appear with no definition — a returning-adult beginner won't know what they're choosing between. The trust-row promises "Top Islamic University Graduates" but clicking a teacher can't verify it (no profile). Will hesitate at "which teacher?" and has nothing deeper to click.

**Vetting Parent — "Maryam" (project persona, from PRODUCT.md):**
- *Profile:* mother choosing a Quran teacher for an 8-year-old; evaluating trust before spending; often on mobile in Arabic RTL; safety and credential-verification are non-negotiable.
- *Red flags:* Cannot open a full teacher profile — the decision rests on a 100-char snippet. Cannot see safeguarding info, a sample lesson, or how the Ijazah was verified. The universal "Certified with Ijazah" banner reads as marketing, not proof, precisely because she can't drill into one teacher and confirm it. "حسب الاتفاق / Schedule on request" for availability gives her no sense of whether a teacher can actually fit her child's time. She'll want the female-teacher filter (present — good) but will stall at the depth wall.

**Casey (Distracted Mobile User):** Primary "Book" action sits at the bottom of a tall card in a 1-col mobile stack — reachable, fine. But there are 12 full cards before the fold ends, no sticky filter access once scrolled (filter is a collapsible at the top only), and pagination controls sit far down. State does persist in the URL (good — an interrupted session resumes). Biggest snag: tapping a teacher's name/avatar does nothing (no profile link), so a one-thumb "tap to learn more" instinct fails.

**Riley (Deliberate Stress Tester):** Price min=100 / max=5 → empty grid, no "check your price range" hint. Very long bios are handled (100-char slice). Search `minLength={2}` present. Refresh mid-filter is safe (URL-driven). The contact link uses the Latin `teacher.name` even when the card shows the Arabic name — the prefill mismatches what she clicked.

## Minor Observations

- "New teacher" rendered in `text-gold` (content.tsx:305) spends the brand's scarcest attention colour on the least-proven teachers. Use muted.
- Desktop filter header "Filters" is `uppercase tracking-wider` (filter-bar.tsx:198) — brushes the No-Kicker Rule; it's a single functional label, not section scaffolding, so low-severity, but a non-caps label would be more on-brand.
- `hidePrices` feature flag is respected in both card and filter — good, but when prices are hidden there's no alternative "contact for pricing" affordance; the price row simply vanishes.
- Contact param `encodeURIComponent(teacher.name)` always uses the Latin name — pass `pickDisplayName`/id for consistency with what the user saw.
- `unoptimized` on the avatar `<Image>` skips Next's image pipeline — acceptable for external Supabase URLs, but no `sizes` and fixed 80×80 means no retina density handling.

## Questions to Consider

- What would a *confident* version of this page look like — one featured teacher given real estate, not twelve equal tiles?
- If a parent can't open a teacher's full story, what exactly is the "Book" button asking them to trust?
- Does the trust-row need to make a universal claim at all, when each card could prove its own?
- Should results be sortable by the thing a parent actually optimizes for (price, experience, availability), rather than a fixed rating-then-sessions order they can't see or change?

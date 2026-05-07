# Student Experience — Design-Director Critique

> **Audit date:** 2026-05-07
> **Scope:** all 30 student surfaces under `/student/**` + the shared `DashboardLayout` shell.
> **Method:** live Chrome via `claude-in-chrome` MCP. Each surface captured in 4 theme/lang combos: dark+Arabic, dark+English, light+Arabic, light+English. Critique is written once per surface, with a "Mode divergences" sub-section noting where combos 2/3/4 break vs. canonical (combo 1 = dark+Arabic).
> **Account state:** populated student (active bookings, completed sessions, recordings, follow-ups, in-progress course, active package).
> **Brand reference:** `.impeccable.md` — "Premium · Refined · Authentic."
> **Plan file:** `~/.claude/plans/melodic-noodling-reef.md`.

This document is appended one cluster at a time. Sections below are reserved as the audit progresses.

---

## 1. Executive Summary

*Reserved — written last, after all per-surface findings exist to summarize.*

---

## 2. Anti-Patterns Verdict (Platform-Wide)

*Reserved — written last.*

---

## 3. Cluster A — Shell &amp; Dashboard

### 3.1 Surface — `/student/dashboard`

**Captures.** ss_6333jnbfe (dark+Ar, top), ss_17819sa9g (dark+Ar, mid), ss_7275ifo1j (dark+Ar, lower-mid), ss_2757esb92 (dark+Ar, bottom). ss_5130ryd5w (light+Ar, top). ss_2232p3md1, ss_2649f2gfo, ss_3065bwfh9 (light+En, top→bottom). ss_1788a9j14, ss_1436n0gt7 (dark+En, top).

**Test account state.** "test student farag / طالب القرآن" — Hafs an Asim recitation, Beginner, juz 1/30 in Surah Al-Fatiha ayah 7. 1 completed session, 0 this month, no active package, 1 scheduled session (Friday May 8, 12:00 PM with Mohamed Farag), 1 recording (hifz, Apr 5, 50%). The "populated" account is **thinly populated** — the dashboard shows a lot of empty/quiet states even on a non-fresh account.

#### Anti-patterns verdict

**PASS, with two caveats.** The page mostly avoids the AI-slop fingerprints — no hero gradient text, no glass-everywhere, no FOMO timers, no generic Inter-on-grey. The Liquid Glass identity (gold-on-black, ornament dividers, calm spacing) reads premium-traditional rather than SaaS-template.

Caveats:
- The KPI grid (`Active Package · Completed · This Month · Next Session`) is still a four-card "hero metric" arrangement — the most fingerprintable AI-dashboard pattern. It's polished and contextual ("Next Session: 1 day" is good copy), so it doesn't read generic, but it sits one design choice away from cliché. Worth pressure-testing whether 4 KPIs is the right count or whether one or two are noise (Active Package is "—" — does that earn its place?).
- The **"Today's Murajaah" card uses transliteration in Latin script** even in Arabic mode ("مراجعة اليوم" is fine, but the English fallback "Today's Murajaah" with Latin spelling shows up in en mode and feels SaaS-y next to the real Arabic). In en+ar variants this hybrid surfaces "Surah Al-Fatiha (1–7) · May 5" — half English, half transliterated. It's not slop, but it's not the dignified Arabic-first vocabulary the brand bible commits to.

#### Nielsen heuristic scores

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | **3** | "Last refreshed at 07:57" + Refresh button is good; per-section loading skeletons exist; but the dashboard shows no spinner when re-fetching after toggle, and the "Active Package: —" never explains what em-dash means. |
| 2 | Match System / Real World | **2** | "Murajaah" left untranslated in Arabic mode reads natural; "hifz" lowercase as a recitation-record subject is unrefined; "ghunna in An-Nasr" mid-sentence breaks the dignified register. The Arabic copy is good; the English copy code-switches awkwardly. |
| 3 | User Control & Freedom | **2** | Dismissible scheduled-session card (✕) — good. But: no obvious way to dismiss the Murajaah block, no way to reorder or hide widgets, the language toggle is one-way per session (no "remember my choice" beyond localStorage). |
| 4 | Consistency & Standards | **1** | Major: weekday axis labels in **English** even in Arabic mode ("Mon, Tues, Wed, Thurs, Fri, Sat, Sun"). Inconsistent abbreviation ("Tues"/"Thurs" 4-letter vs. 3-letter for the rest — same defect noted in teacher dashboard memo). Date format "Apr 05, 2026" English in Arabic mode. HTML `<title>` stays "لوحتي \| فرقان" even when UI is English. |
| 5 | Error Prevention | **3** | Few destructive actions on the dashboard; the dismissible schedule card has no "are you sure" but that's correct restraint. |
| 6 | Recognition Rather Than Recall | **3** | Icons paired with KPI labels — good. Sidebar nav has icon+label always, no icon-only mode that would force recall. |
| 7 | Flexibility & Efficiency | **2** | Footer shortcut row ("Shortcuts ?") exists — power users get keyboard shortcuts. But: no keyboard-only path to the language or theme toggles (must mouse to topbar pill). No way to skip to "next action" from keyboard. |
| 8 | Aesthetic & Minimalist Design | **3** | Generous spacing, single-CTA-per-card discipline, ornament dividers used sparingly. The thin gold hairline at the top of the page is a nice touch. The KPI grid is dense but not crowded. |
| 9 | Error Recovery | **2** | `loading.tsx` exists but error.tsx is not specific to `/dashboard` — falls through to `src/app/student/error.tsx`. Couldn't trip an error in Chrome, so not directly observable, but the structural audit flagged it. |
| 10 | Help & Documentation | **2** | "?" tooltip beside "Surah Al-Fatiha · Ayah 7" — single help affordance. No "What is Murajaah?" help anywhere despite the term being foreign to ~half the audience (English-only beginners). Help Center link in sidebar — discoverable, not promoted. |
| **Total** | | **23/40** | "Functional with consistency debt" |

#### Visual hierarchy

The eye lands on **"Welcome back, test"** first (correct primary anchor — affirming identity at top). Second land is the **scheduled-session card** with "Open details →" CTA (correct — this is the most actionable thing for a student today). Third is the **teacher's-focus banner** (correct — this is the only personalized recommendation on screen). Fourth is the **KPI grid**.

**Failure point:** the teacher's-focus banner has *two* competing CTAs — the title link "Your teacher's focus this week" (which goes nowhere visible) and "View full evaluation →" on the far end. In RTL the latter sits at the start of the line, which makes the eye travel back-and-forth across a body paragraph that's *also* in English. The banner reads as cluttered for a one-message card. **One CTA per card** is the brand rule; here there are two.

#### Cognitive load (8-item check)

1. **Number of competing visual elements** — top viewport has 5 (title, recitation pill, beginner pill, mushaf bar, scheduled-session card). PASS.
2. **More than 7 navigation options at once** — sidebar shows 10+ items in the GENERAL section (Arabic mode). FAIL.
3. **Vague labels** — "Murajaah" without explanation; "باقتي" with em-dash. PARTIAL FAIL.
4. **Ambiguous icons** — KPI cards icons are paired with labels, OK. PASS.
5. **Missing affordances** — the recitation-standard pill ("Hafs an Asim") looks clickable in light mode (blue, outlined like CTAs) but isn't. FAIL.
6. **Inconsistent vocabulary** — "Sessions" / "جلساتي" vs. "Murajaah" untranslated; "hifz" lowercase vs. proper noun convention. FAIL.
7. **Disabled-state ambiguity** — em-dash for empty package vs. no rendered card. PARTIAL FAIL.
8. **Decision points without recovery** — none surfaced on dashboard. PASS.

**Failure count: 4** → CRITICAL. Most of the failures are vocabulary/affordance polish, not catastrophic IA — but they accumulate to a feeling of "this looks done but reads ragged."

#### Emotional journey

**Peak.** The "Welcome back, test · Hafs an Asim · Beginner · You are in Surah Al-Fatiha · Ayah 7" identity strip is *the* emotional anchor of FURQAN. It says "we know exactly where you are." That's the brand promise. PEAK ACHIEVED.

**Valley.** The teacher's-focus banner — the second-most-emotional card on the page — falls flat in Arabic mode because **the teacher's narrative is in English regardless of locale**. An Arabic-monolingual student opens their dashboard, sees a label that says "تركيز معلمك لهذا الأسبوع" (your teacher's focus this week), then reads "Memorize Surah An-Nas + An-Naas correctly with full tajweed by next session. Practice ghunna in An-Nasr." in Latin script. This is the **single most damaging UX defect on the dashboard** — it's a peak-emotional moment (a student receiving guidance from their sheikh) ruined by an i18n gap. Persona "Umm Khalid" (Arabic-monolingual elder) cannot consume this content at all.

**End.** Page bottom is a quiet "Last refreshed at 07:57 AM · Shortcuts · Refresh" footer. Calm, no upsell, no "Upgrade now" pop-up. Brand-correct.

#### Discoverability & affordance

- KPI cards are NOT clickable (verified by hovering — no hand cursor) but visually look elevated like cards that should drill in. **AFFORDANCE FAIL** — either make them links to the relevant detail page (e.g., "Completed: 1" → /student/sessions?status=completed) or remove the elevation that suggests interactivity.
- "Open details →" pill on the scheduled-session card is unambiguously a CTA — gold filled, arrow icon, gold hover. PASS.
- The blue (light mode) "Hafs an Asim" recitation-standard pill has the same outlined-pill geometry as the "Open details →" CTA. **Same shape ≠ same role** is a violation of the brand rule "Gold means action" (and its skin equivalent "Blue means action").
- The sidebar's GENERAL/LEARNING section headers have a chevron-down icon — implies collapsibility — but I saw conflicting collapse states between Arabic and English captures (Arabic showed GENERAL expanded with 10 items; English showed LEARNING expanded with different items). Either the sections collapse independently per locale, or the toggle state isn't persisted across language switches. **Needs source verification at `src/components/shared/dashboard-layout.tsx`.**
- "Shortcuts ?" footer button is keyboard-discoverable and shows a modal. PASS.

#### Composition & balance

- Two-column-ish layout: sidebar (224px) + main (max-w-7xl). The main column has generous padding (`py-8 sm:py-10`). PASS.
- The Murajaah card mid-page renders **three rows of equal weight** ("Yesterday · Last Week · Last Month") even when 2 of 3 are empty placeholders. Two-thirds of the card is "Nothing new in this window" rendered identically in muted grey. That's whitespace-as-noise, not whitespace-as-silence. **Compress to one row when only one period has content** — show "Last Week: Surah Al-Fatiha (1–7) · May 5" and a small "View older" link, not three rows of empty.
- The Report Analytics chart (Y axis 0/4/8/16/24h) takes up roughly half the lower-mid viewport but **renders zero bars** in this account state. A 60×800px empty grid is visually heavy; an empty-state placeholder ("Start logging time to see your weekly hours") would carry more weight.
- The recent-recordings table has a **single row** spanning the full width (max-w-7xl ≈ 1280px). That single row reads as a list manifest, not a table. **Tables ≥ 1 row look bad until they have ≥ 5 rows.** Compress to a card when N=1.

#### Typography

- Display / Amiri loaded for the welcome heading: confirmed. The heading "أهلاً، test" mixes Amiri Arabic with a Latin first-name in (presumably) Cairo or system serif fallback. The Latin "test" sits awkwardly tall against the Arabic letterforms. **Recommend** transliterating known student first names server-side, OR rendering the welcome as just "أهلاً بعودتك" without the name.
- Body text: Cairo. Comfortable. PASS.
- The "POSITION IN THE MUSHAF" caps label uses a small-caps sans-serif — readable, mildly LMS-coded. Could be replaced by a softer Arabic label ("الموقع في المصحف" already exists; in en mode the caps-English version is unnecessarily institutional).
- KPI numerals are very heavy — possibly `font-weight: 800-900` at 80–100px. They're visually dominant; a 700-weight at 56–72px would read as more "premium reference card" and less "fitness app dashboard."

#### Color

- Dark mode: gold (`#C8A652`) is correctly reserved for actionable elements (the "Open details →" CTA, focus-banner accent text, "ابدأ المراجعة" button, "View full evaluation →" link). PASS for the action-rule.
- **Violation:** "Hafs an Asim" recitation-standard pill uses **gold-tinted border + gold-tinted text** in dark mode, even though it's a static taxonomy chip. This is the exact "gold should never appear on static/decorative elements" rule from `.impeccable.md`. The fix is a non-gold neutral (e.g., warm-grey outline + warm-grey text, OR a calligraphic ornament prefix without the gold token).
- Light mode: blue accent replaces gold (per student-dashboard-skin design). The same violation repeats: "Hafs an Asim" pill is blue-on-blue, sharing the action color with "Open details" / "Start review" / "Book a new session →".
- The position-in-mushaf progress bar fill is a **green chip** in dark mode (#4CAF7D-ish, the success token) and a **blue chip** in light mode. Inconsistent semantics — progress is neither "success" nor "action."

#### States

- **Empty (today's plan):** "لا شيء مجدول لليوم — لكن هناك متابعات قادمة. ربما الوقت مناسب لمراجعة هادئة." with "احجز جلسة جديدة ←" CTA. **EXCELLENT** — warm, dignified, suggests an alternative ("a quiet review"), single CTA. This is exactly the brand voice. Frame this as the canonical empty-state pattern in `EmptyCard`.
- **Empty (live sessions):** "لا توجد جلسات مباشرة الآن" / "No live sessions right now". Functional, neutral.
- **Empty (follow-up breakdown):** A thin grey bar with just "متبقي / Remaining" label. **Too quiet** — the user can't tell whether this is "you haven't been assigned any follow-ups" or "you finished everything" or "the data didn't load." Three different meanings, one rendering.
- **Loading:** Couldn't reproduce in steady state, but `loading.tsx` exists with skeleton matching the page (per structural audit doc).
- **Error:** Couldn't reproduce. Falls through to `src/app/student/error.tsx`.

#### Microcopy & voice

- "أهلاً، test" — warmth. PASS in tone.
- "تركيز معلمك لهذا الأسبوع" — beautiful Arabic phrasing. PASS.
- "احجز جلسة جديدة ←" — calm action verb, no exclamation. PASS.
- "Today's Murajaah · Review for just 5 minutes" — "just 5 minutes" reads slightly SaaS-coachy ("only 5 minutes!"). The Arabic "راجع 5 دقائق فقط" reads better. Tighten the English to "5-minute review".
- "Your teacher's focus this week" — good. The English body content underneath is teacher-authored, not platform copy, so the platform can't fix it directly — but the platform CAN auto-translate or at least display a "(English original)" disclaimer when user locale differs from author locale.
- "View full evaluation →" — fine, standard.
- Footer: "Last refreshed at 07:57 AM · Shortcuts · Refresh" — restrained, appropriate.

#### Mode divergences

| Mode | Issue | Severity |
|------|-------|----------|
| Dark + Arabic (canonical) | Teacher's-focus body in English (data, not theme) | P0 |
| Dark + Arabic | Weekday axis "Mon, Tues, Wed, ..." English | P1 |
| Dark + Arabic | "hifz" course label untranslated | P1 |
| Dark + Arabic | "Apr 05, 2026" date format English | P1 |
| Dark + English | HTML `<title>` stays "لوحتي \| فرقان" even when UI is English | P0 |
| Light + Arabic | Sidebar appeared to remain dark on first paint after theme toggle (transient) | P1 — needs reproduction |
| Light + Arabic | "Hafs an Asim" pill in blue, sharing action color with CTAs | P1 |
| Light + English | KPI grid did not render in viewport after lang toggle (possible re-render flash) | P2 — verify |
| All four | Sidebar visible item-set differs between Arabic and English captures | P0 — needs source verification |
| Dark | Status badge "Beginner / مبتدئ" is muted-on-muted, near invisible at glance | P2 |
| Light | Position-bar fill switches green→blue between modes (semantic drift) | P2 |

#### Persona red flags

- **Alex (power user)** — only one explicit keyboard affordance ("Shortcuts ?"). No hotkey to jump to the next action. The dashboard density is fine for Alex; he's likely to skip it and bookmark `/student/sessions` directly. Low concern, low value.
- **Jordan (first-timer)** — sees "Murajaah" without explanation, "Hafs an Asim" without explanation, "ayah 7" without context. The dashboard assumes domain literacy. **Onboarding gap** — first-paint guidance ("New here? Start with…") is absent.
- **Layla (7-year-old)** — heavy text-density. No illustrations, no calm imagery, no "kid-friendly" lane. The brand is dignified across ages, which is correct, but children typically need slightly larger touch targets and more whitespace. Likely OK for parent-supervised use; risky for a 7-year-old solo navigation.
- **Sheikh Hassan (hāfiz scholar)** — likes the Arabic typographic care but will be irritated by "hifz" lowercase (unrefined for his discipline) and the English-only teacher narrative. The content respects his standards in form but breaks them in substance.
- **Umm Khalid (Arabic-monolingual elder)** — **CANNOT consume the teacher's-focus content** (English-only). Cannot read "Mon Tues Wed" axis. Cannot read "Apr 05, 2026". For her, half the dashboard is unusable. Critical persona-failure.

#### Priority issues

- **[P0] Teacher-narrative i18n gap.** `src/app/student/dashboard/dashboard-content.tsx` (the teacher's-focus card) renders teacher-authored evaluation text verbatim regardless of viewer locale. Backend stores it in whatever language the teacher wrote it (likely English). **Fix**: either (a) require teachers to enter both Arabic and English versions for any student-visible field, OR (b) auto-translate via OpenAI/Anthropic at write-time and cache the translation, OR (c) display a "Original in English — اضغط للترجمة" affordance. Suggested command: **/clarify** for the microcopy + a backend follow-up issue.
- **[P0] HTML `<title>` not localized.** `src/app/student/dashboard/page.tsx` `metadata.title` is hardcoded Arabic. **Fix**: use `generateMetadata` that reads the locale cookie/header and returns the matching title. Suggested command: **/harden**.
- **[P0] Sidebar item-set may diverge between locales.** Needs source verification at `src/components/shared/dashboard-layout.tsx` (the shell). If the items are configured per-locale rather than translated, that's a major IA defect. Suggested command: **/normalize**.
- **[P1] Weekday axis labels not localized.** "Mon, Tues, Wed, Thurs, Fri, Sat, Sun" appear in English in Arabic mode, with inconsistent abbreviation. Likely lives in `AnalyticsChart` or a chart-config helper. Suggested command: **/normalize**.
- **[P1] Course/recitation labels not localized.** "hifz" lowercase, "Apr 05, 2026" English date in Arabic mode. Probably in `dashboard-queries.ts` (matches the teacher-dashboard finding from the 5/6 audit). Suggested command: **/normalize**.
- **[P1] Recitation-standard pill uses action color.** "Hafs an Asim" pill is gold-on-gold (dark) / blue-on-blue (light). Static taxonomy ≠ action. **Fix**: re-skin the recitation-standard pill to neutral warm-grey-on-translucent. Suggested command: **/normalize**.
- **[P1] Teacher's-focus card has two competing CTAs.** "Your teacher's focus this week" (title) and "View full evaluation →" (corner) both look clickable. **Fix**: pick one — make the whole card clickable with one chevron, OR remove the title-as-link styling. Suggested command: **/distill**.
- **[P2] Welcome heading mixes Latin first-name with Arabic.** "أهلاً، test" reads ragged. Suggested command: **/clarify** (microcopy).
- **[P2] Murajaah card renders three rows even when two are empty.** Compress to a single "most recent review" row. Suggested command: **/distill**.
- **[P2] Report Analytics chart Y-axis non-linear (0/4/8/16/24).** Same defect as teacher dashboard memo. **Fix**: 0/6/12/18/24 or 0/8/16/24. Suggested command: **/normalize**.
- **[P2] KPI cards look clickable but aren't.** Either link them to the relevant detail page or remove the card elevation. Suggested command: **/clarify** (affordance) or **/extract** (a `LinkableStatCard` variant).
- **[P3] KPI numerals too heavy at ~80px / 800-weight.** Slight de-bolding would feel more "reference card" than "fitness dashboard." Suggested command: **/typeset**.

### 3.2 Cross-cutting Shell observations (folded into §10 later)

Notes captured here, expanded in the cross-cutting findings section after all clusters complete:

- Topbar order in dark+Ar (RTL): `[· · ·] [EN A] [☀] [🔔] [📅 2026]` from left to right. In dark+En (LTR): `[📅 2026] [🔔] [☀] [عربي] [· · ·]`. Symmetric mirror — PASS.
- The lang toggle pill in dark mode: dark surface, gold border, "EN" + flag-icon when in en mode; "عربي" + flag-icon when in ar mode. Discoverable.
- The theme toggle in dark mode is a sun icon (= "switch to light"); in light mode it's a moon icon (= "switch to dark"). Standard convention.
- The "2026" calendar pill in the topbar is a year picker — not obvious what it controls. Hovering doesn't reveal a tooltip. **Discoverability concern** — what does selecting a different year do? Filter the dashboard to a past year? Time-travel? **Source-check needed.**
- Sidebar collapse-state appears NOT to persist across language switches (verified — General was expanded in Ar, collapsed in En, on the same session).
- WhatsApp-shaped "Support" link in green (the only green element in the entire shell). Stands out for the right reason in dark mode; reads slightly Christmas-y next to gold. Acceptable but noteworthy.
- Footer "Last refreshed at 07:57 AM" timestamp is shown as 24h Arabic ("ص" suffix = AM) in Arabic mode and 12h English in English mode. Locale-correct ✓.


---

## 4. Cluster B — Discovery &amp; Booking

*Reserved.*

---

## 5. Cluster C — Live Learning

*Reserved.*

---

## 6. Cluster D — Self-Paced Learning

*Reserved.*

---

## 7. Cluster E — Practice &amp; Assessment

*Reserved.*

---

## 8. Cluster F — Communication

*Reserved.*

---

## 9. Cluster G — Account

*Reserved.*

---

## 10. Cross-Cutting Findings

*Reserved — written last.*

---

## 11. Persona Red-Flags Matrix

*Reserved — written last.*

---

## 12. Recommended Actions

*Reserved — written last.*

---

## Appendix A — Per-Surface Score Index

| # | Cluster | Surface | Nielsen /40 | AI-Slop | Top P0/P1 |
|---|---------|---------|-------------|---------|-----------|
| 1 | A | `/student` (dashboard) | **23/40** | PASS w/caveats | P0 teacher-narrative i18n; P0 HTML title not localized; P0 sidebar items diverge between locales |
| 2 | B | `/student/teachers` | — | — | — |
| 3 | B | `/student/teachers/[id]` | — | — | — |
| 4 | B | `/student/bookings` | — | — | — |
| 5 | C | `/student/sessions` | — | — | — |
| 6 | C | `/student/sessions/[id]` | — | — | — |
| 7 | C | `/student/classes` | — | — | — |
| 8 | C | `/student/classes/[id]` | — | — | — |
| 9 | C | `/student/halaqas` | — | — | — |
| 10 | C | `/student/halaqas/[id]` | — | — | — |
| 11 | C | `/student/group-sessions` | — | — | — |
| 12 | C | `/student/time-tracker` | — | — | — |
| 13 | D | `/student/courses` | — | — | — |
| 14 | D | `/student/courses/[id]` | — | — | — |
| 15 | D | `/student/courses/[id]/lessons/[lessonId]` | — | — | — |
| 16 | D | `/student/quizzes` | — | — | — |
| 17 | D | `/student/quizzes/[id]` | — | — | — |
| 18 | E | `/student/recitations` | — | — | — |
| 19 | E | `/student/recitations/[id]` | — | — | — |
| 20 | E | `/student/follow-up` | — | — | — |
| 21 | E | `/student/ijazah` | — | — | — |
| 22 | E | `/student/progress` | — | — | — |
| 23 | E | `/student/timeline` | — | — | — |
| 24 | F | `/student/messages` | — | — | — |
| 25 | F | `/student/notifications` | — | — | — |
| 26 | F | `/student/notes` | — | — | — |
| 27 | G | `/student/resources` | — | — | — |
| 28 | G | `/student/packages` | — | — | — |
| 29 | G | `/student/settings` | — | — | — |

*Filled in as each cluster completes.*


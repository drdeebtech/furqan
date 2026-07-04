---
name: furqan.today
description: A premium, reverent Quran-memorization platform — gold on near-black, illuminated-manuscript calm.
colors:
  gold: "#C8A652"
  gold-hover: "#B8963E"
  gold-light: "#D4B76A"
  gold-ink-light: "#8A6D1A"
  background: "#0F0F0F"
  foreground: "#F5F0E8"
  surface: "#1A1A1A"
  surface-light: "#222222"
  surface-border: "#2A2A2A"
  muted: "#9C9488"
  muted-light: "#8E8E86"
  app-surface: "#FFFFFF"
  student-accent-blue: "#3B82F6"
  accent-purple: "#7C5CFF"
  accent-green: "#22C55E"
  data-progress: "#34D399"
  success: "#4CAF7D"
  warning: "#E0A830"
  error: "#E05555"
typography:
  display:
    fontFamily: "Rakkas, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw, 4rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, var(--font-body), system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  numeral:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "IBM Plex Sans Arabic, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  chip: "4px"
  sm: "12px"
  card: "16px"
  md: "18px"
  lg: "24px"
  pill: "9999px"
spacing:
  btn-sm: "0.375rem 0.75rem"
  btn-md: "0.625rem 1rem"
  btn-lg: "0.875rem 1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.background}"
    rounded: "{rounded.pill}"
    padding: "{spacing.btn-lg}"
  button-primary-hover:
    backgroundColor: "{colors.gold-hover}"
    textColor: "{colors.background}"
    rounded: "{rounded.pill}"
    padding: "{spacing.btn-lg}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "{spacing.btn-md}"
  card-glass:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
  input-field:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0.625rem 1rem"
---

# Design System: furqan.today

## 1. Overview

**Creative North Star: "The Gilded Manuscript"**

furqan is gold on near-black — brand gold (`#C8A652`) resting on a deep `#0F0F0F`
ground, the way illuminated Qur'anic calligraphy sits on aged vellum. The system
is reverent before it is anything else: the subject is sacred, so every choice
favours the dignified over the clever. Warmth is carried by a single warm metal
and a soft gold radial glow that rises from the top of the page, never by bright
colour or busy ornament. The result reads as *premium, refined, calm* — quiet
luxury for people making a serious, often emotional decision about memorizing the
Quran.

It runs in two registers under one identity. The **marketing skin** is the dark
manuscript: gold-on-black, atmospheric glow, display serif. The **app-shell** is
its daylight counterpart — a light surface (`#FFFFFF`) on a soft tinted body,
where gold darkens to `#8A6D1A` to hold WCAG AA on white and the student
dashboard repoints its primary accent to a calm blue (`#3B82F6`) for long working
sessions. Both draw from the same tokens, so deciding-to-join and doing-the-work
feel like one place.

The system explicitly rejects the generic SaaS dashboard (hero-metric templates,
gradient blobs, identical icon-card grids), childish or gamified edtech (mascots,
confetti, cartoon primaries), cold clinical fintech, and the cluttered ornate
religious-web look. Restraint is the differentiator.

**Key Characteristics:**
- Gold-on-near-black as the signature; one warm metal carries the identity.
- Reverent and calm — dignity over decoration, space over density.
- Bilingual by design: full RTL/Arabic is first-class, not a translation layer.
- Contrast-tuned to WCAG AA across three skins (dark, light, student-blue).
- Tactile, confident components on a Liquid-Glass surface vocabulary.

## 2. Colors

A single warm metal on deep near-black, with a small, disciplined set of
functional accents.

### Primary
- **Manuscript Gold** (`#C8A652`): the brand. Primary CTAs, active states, focus
  rings, key accents, the page's radial glow. On dark it passes AA as text
  (8.2:1); on light surfaces it is never used as body text — it darkens to
  **Ink Gold** (`#8A6D1A`, 4.9:1 on white) for that role.
- **Gold Hover** (`#B8963E`) / **Gold Light** (`#D4B76A`): pressed and raised
  states of the metal.

### Secondary
- **Study Blue** (`#3B82F6`, text-safe `#2563EB`): the student dashboard's working
  accent. Calmer than gold for hours of daily use; scoped to that skin only.

### Tertiary
- **Progress Emerald** (`#34D399` / `#22C55E`): memorization progress and success
  data only. Never decorative.
- **Deep Violet** (`#7C5CFF`): a rare secondary accent for non-primary emphasis.

### Neutral
- **Vellum Ink** (`#F5F0E8`): primary foreground on dark — warm off-white, not
  pure white.
- **Near-Black Ground** (`#0F0F0F`): the manuscript body.
- **Raised Surface** (`#1A1A1A`) / **Higher Surface** (`#222222`): cards and
  layered panels on dark.
- **Hairline Border** (`#2A2A2A`): dividers and card edges on dark.
- **Muted** (`#9C9488`) / **Muted Light** (`#8E8E86`, 5.3:1 AA): secondary text.
- **App White** (`#FFFFFF`): the light app-shell surface.

### Semantic
- **Error** (`#E05555`) · **Warning** (`#E0A830`) · **Success** (`#4CAF7D`).

### Named Rules
**The One Metal Rule.** Gold is the only brand colour. It is never joined by a
second decorative hue on the same surface; blue, emerald and violet are *scoped
functional accents* (a skin, a data type), never co-stars. If a screen has two
brand colours competing, one of them is wrong.

**The Gold-As-Text Rule.** Brand gold `#C8A652` is for backgrounds, borders and
large accents. As body text it only appears on dark (≥4.5:1). On any light
surface, gold text becomes Ink Gold `#8A6D1A`. Never ship `#C8A652` text on white.

## 3. Typography

**Display Font:** Rakkas (with Georgia, serif) — a warm Arabic-and-Latin display
serif; the illuminated-manuscript voice.
**Body Font:** IBM Plex Sans Arabic (with Inter, system-ui) — a humanist sans that
renders Arabic and Latin with equal care; ships weights 300–700.
**Numeral/Label Font:** Inter — forced explicitly for KPI numerals and Latin
figures so digits never fall through to the Arabic body face.

**Character:** A display serif against a humanist sans — paired on a genuine
contrast axis (serif vs. sans), never two similar sans. Rakkas brings reverence
and warmth to headings; Plex Sans Arabic keeps running text calm, legible, and
truly bilingual.

### Hierarchy
- **Display** (Rakkas 400, `clamp(2.25rem, 5vw, 4rem)`, line-height 1.05): hero
  and section headlines on marketing surfaces. Ceiling ~4rem — the page is
  designed, not shouting. `text-wrap: balance`.
- **Headline** (Inter/body 600, `clamp(1.5rem, 3vw, 2.25rem)`, 1.15): sub-heads
  and card titles.
- **Numeral** (Inter 700, 48px, line-height 1): KPI figures and progress counts.
  Always Inter, never the Arabic body face.
- **Body** (Plex Sans Arabic 400, 1rem, 1.6): running text. Cap measure at
  65–75ch; `text-wrap: pretty` on long prose.
- **Label** (Inter 500, 0.875rem): buttons, form labels, dense controls.

### Named Rules
**The Bilingual-First Rule.** Every type choice must render correctly in Arabic
RTL *and* Latin LTR. A font or size that only works for one script is not shipped.

**The No-Kicker Rule.** No tiny uppercase tracked eyebrow above every section, and
no `01 / 02 / 03` numbered markers as default scaffolding. Hierarchy comes from
the Rakkas display scale, not from a repeated all-caps label.

## 4. Elevation

A **hybrid** system — depth is expressed differently in each register, honestly,
rather than forced into one language.

- **Dark marketing skin:** depth is *light*, not shadow. A gold radial glow rises
  from the top of the body; surfaces separate by tonal step (`#0F0F0F` → `#1A1A1A`
  → `#222222`) and hairline borders (`#2A2A2A`). Structural shadows exist as a
  four-step dark ramp (`elevation-1..4`) for overlays and menus.
- **Light app-shell:** soft ambient shadows do the work — `0 1px 2px
  rgba(17,24,39,0.04)` at rest lifting to `0 8px 24px rgba(0,0,0,0.04)` on hover
  — white cards on a tinted body.

### Shadow Vocabulary
- **elevation-1** (`0 2px 8px rgba(0,0,0,0.3)`): raised cards on dark.
- **elevation-2** (`0 4px 16px rgba(0,0,0,0.35)`): dropdowns, popovers.
- **elevation-3** (`0 8px 24px rgba(0,0,0,0.4)`): modals.
- **elevation-4** (`0 16px 40px rgba(0,0,0,0.45)`): peak overlays.
- **app-rest** (`0 1px 2px rgba(17,24,39,0.04)`) / **app-hover** (`0 2px 6px
  rgba(17,24,39,0.06), 0 8px 24px rgba(0,0,0,0.04)`): the light app-shell card.
- **gold-focus-pulse** (`0 0 0 0 → 12px rgba(200,166,82,0.4→0)`): the signature
  attention ring; a single expanding gold halo, never a bounce.

### Named Rules
**The Glow-Not-Glare Rule.** On dark, reach for tonal layering and the gold glow
before a hard shadow. Heavy black drop-shadows on the manuscript ground read as
cheap; the light does the lifting.

## 5. Components

Components feel **tactile and confident** — pressable, with a clear hover lift and
satisfying feedback — built on a Liquid-Glass surface vocabulary (radii 12/18/24px,
pill; spring `cubic-bezier(0.25, 1, 0.5, 1)`).

### Buttons
- **Shape:** fully pill (`9999px`). This is the house shape — buttons are lozenges,
  not rounded rectangles.
- **Primary:** solid Manuscript Gold (`#C8A652`) with near-black ink, `btn-lg`
  padding on marketing CTAs. Minimum touch target 44×44 (`btn-md`, WCAG 2.5.5).
- **Hover / Focus:** gold shifts to `#B8963E`, a 2px upward translate on the
  spring curve, and a gold focus-visible ring. Never a bounce or elastic.
- **Ghost:** raised surface (`#1A1A1A`) with vellum ink and a hairline border for
  secondary actions.

### Cards / Containers
- **Corner Style:** 16px (app cards) to 24px (glass panels).
- **Background:** raised surface `#1A1A1A` on dark; `#FFFFFF` in the light app.
- **Shadow Strategy:** per Elevation — tonal + glow on dark, soft ambient in the
  light app. Glass panels use `backdrop-filter`; the light app-shell removes it.
- **Border:** 1px hairline (`#2A2A2A` dark, `#E5E7EB` light).
- **Internal Padding:** 24px default.

### Inputs / Fields
- **Style:** higher-surface fill (`#222222`), 1px border (`#333333`), 12px radius.
- **Focus:** border shifts to gold (`#C8A652`) with a matching focus ring.
- **Error:** border and message in `#E05555`.

### Navigation
- Vellum-ink labels on the dark ground; gold marks the active item. Hover lifts
  opacity/underline. Mobile collapses to a sheet; touch targets stay ≥44px.

### Signature — The Gold Focus Pulse
A single expanding gold halo (`gold-focus-pulse`) draws the eye to the one thing
that matters on a screen — a booking CTA, a newly-unlocked lesson. Used sparingly;
its rarity is the point.

## 6. Do's and Don'ts

### Do:
- **Do** keep gold as the one brand metal; let blue, emerald, and violet stay
  *scoped functional accents* (a skin, a data type), never co-stars.
- **Do** darken gold to Ink Gold `#8A6D1A` for any text on a light surface (AA).
- **Do** pair the Rakkas display serif against the Plex/Inter sans on a real
  contrast axis; hold the display ceiling at ~4rem.
- **Do** convey depth on dark with tonal steps and the gold glow first.
- **Do** make every surface render correctly in Arabic RTL and Latin LTR.
- **Do** ship a `prefers-reduced-motion` fallback for every animation, including
  the gold pulse (it becomes a static ring).

### Don't:
- **Don't** build the **generic SaaS dashboard** — no hero-metric templates,
  gradient blobs, or identical icon-heading-text card grids.
- **Don't** drift **childish / gamified** — no mascots, confetti, or bright
  cartoon primaries. Undignified for the Quran.
- **Don't** go **cold / clinical / corporate** — no sterile fintech navy or
  austere impersonal grids; keep the warmth.
- **Don't** clutter into a **busy ornate religious site** — no dense text walls
  or dated Islamic-web ornament. Restraint is the brand.
- **Don't** use gradient text (`background-clip: text`), side-stripe borders
  (`border-left` >1px as a colored accent), or a tracked uppercase eyebrow above
  every section.
- **Don't** put brand gold `#C8A652` as text on white, or heavy black
  drop-shadows on the dark manuscript ground.

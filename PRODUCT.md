# Product

## Register

brand

<!-- Split project: marketing surfaces (landing, pricing, teacher marketplace,
trust/booking) are the default register. The logged-in app (student/teacher/admin
dashboards) is a product-register surface — override per task with the product
lens when working inside `src/app/{student,teacher,admin}/**`. -->

## Users

Two audiences meeting on one platform:

- **Learners & families** choosing where to memorize the Quran — often hesitant
  beginners, parents vetting a teacher for a child, or adults returning to study.
  Context: evaluating trust before spending money, frequently on mobile, many in
  RTL/Arabic locales. Job to be done: *find a credible teacher and start with
  confidence.*
- **Teachers** running their practice — managing bookings, sessions, and student
  progress inside the app. Context: focused work sessions, repeat daily use. Job
  to be done: *teach and track memorization without friction.*

## Product Purpose

furqan.today is a Quran-memorization (hifz) platform: it connects students with
vetted teachers, runs live sessions, and tracks memorization with an exact,
never-overwritten progress model. It exists to make serious Quran study
trustworthy and accessible online — where the sacredness of the text and the
honesty of every claim matter as much as the software. Success: a hesitant
visitor trusts the platform enough to book, and a teacher runs their whole
practice inside it.

## Brand Personality

**Premium · refined · calm.** Quiet luxury, not loud marketing. The voice is
credible and unhurried — an expert who has nothing to prove and never oversells.
Warmth is carried by care and craft (gold on near-black, generous space, precise
typography), never by noise. Reverent toward the subject; honest to a fault.

## Anti-references

Explicitly avoid:

- **Generic SaaS dashboard** — hero-metric templates, gradient blobs, identical
  icon-heading-text card grids, Linear/Stripe-clone chrome.
- **Childish / gamified edtech** — mascots, confetti, bright cartoon primaries.
  Undignified for the Quran; alienates serious learners and parents.
- **Cold / clinical / corporate** — sterile fintech navy, austere impersonal
  grids. Loses the warmth and reverence the subject demands.
- **Cluttered / busy religious site** — ornate over-decoration, dense text walls,
  dated Islamic-web tropes. Restraint is the differentiator.

## Design Principles

1. **Reverence before flourish.** The subject is sacred. When a choice is between
   clever and dignified, choose dignified. Restraint reads as respect.
2. **Exactness is the aesthetic.** `surah:ayah` integrity, honest availability
   copy, no overstated claims — precision *is* the brand. Never let the UI imply
   more than is true. (This is why the recent work is all trust and honesty.)
3. **Earn trust visibly.** Show real teachers, real credentials, honest limits.
   The design's job on marketing surfaces is to convert hesitation into a booking
   without a single exaggeration.
4. **Warmth without noise.** Welcoming to a nervous beginner or a vetting parent —
   calm, human, unhurried. Never bright, busy, or salesy to get there.
5. **One identity, two registers.** Marketing dazzles; the app disappears. Both
   draw from the same gold / near-black / Liquid-Glass system so the platform
   feels like one place, whether you're deciding to join or doing daily study.

## Accessibility & Inclusion

- **WCAG 2.1 AA** target — body text ≥4.5:1, large text ≥3:1. The token layer is
  already contrast-tuned (see the gold-ink light-mode override and muted-color AA
  fixes in `globals.css`); hold that bar.
- **Full RTL / Arabic** is a first-class requirement, not a translation layer —
  every surface must render correctly right-to-left with Arabic typography.
- **Reduced motion**: every animation ships a `prefers-reduced-motion` fallback.
- **Touch targets ≥44×44px** for every interactive control (WCAG 2.5.8), so
  password toggles, icon buttons, and links stay comfortably tappable.
- **Visible focus** on every focusable element — the branded gold `focus-ring`
  utility (never `outline: none` without a replacement).
- Reverent, family-safe tone for all ages and a global, multilingual audience.

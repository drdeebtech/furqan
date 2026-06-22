# furqan.today — Marketing Plan

> Grounded in `.agents/product-marketing.md` (source of truth, 2026-06-22). Update both together.
> Scope: go-to-market for the subscription hifz platform. Honest about what's gated.

## 0. Reality gates (read first)

- **Stripe is still test/cutover** (spec 024). Do **not** run paid acquisition at scale until the live key flip + the single-session refund-ownership decision are done. → **organic/pre-launch now; paid after go-live.**
- **Three conversion-negative policies**: paid-only trial, support-only cancel, missed-session-lost. Fixing the *policy* (self-serve cancel + a makeup/reschedule rule) will lift conversion more than any copy. Prioritize before heavy spend.
- **No social proof exists yet** — start collecting testimonials + counts from day one (it's the biggest trust lever after certification).

## 1. Positioning

- **One-liner:** "Memorize the Qur'an with Ijazah-certified teachers — live, structured, from **$12/month**."
- **Category:** online hifz with *certified* teachers + *tracked, never-lost* progress.
- **Differentiators (all true):** Ijazah-certified + CV-reviewed teachers; affordable **group ($12–$20)** and serious **1:1 ($40–$80)** tracks; progress **merged-never-overwritten**; **family accounts + sibling discounts**; specialist-matched **assessment session**; full **Arabic/RTL**; live video.

## 2. Ideal customers (segments)

| Segment | Who | Lead plan | Hook |
|---|---|---|---|
| **A. Guardians** (primary) | Parents enrolling kids | Group $12–$15 | Certified+safe teachers; sibling discount |
| **B. Serious adults** | Adult hifz/tajweed learners | Individual $40–$60 | Tailored curriculum + assessment |
| **C. Diaspora** | Muslims in non-Arabic-majority countries | Either | USD pricing fits; "across time zones"; Arabic teachers |
| **D. Teachers** (supply) | Ijazah holders | — | `/teach-with-us` funnel (separate) |

## 3. Funnel

- **Acquire:** SEO ("learn Quran online", hifz, tajweed), short-form video (recitation/teacher clips), referrals, mosque/community + influencer partnerships.
- **Convert:** `/pricing` (now CRO'd) → **paid assessment session as the "try" step** (there's no free trial, so this is the low-commitment entry) → checkout (409 guard if already subscribed).
- **Activate:** first session booked + attended; teacher selection onboarding.
- **Retain:** additive monthly credits, progress tracking, murajaah scheduler; recover `past_due` via dunning.
- **Refer/expand:** sibling discount, guardian multi-child, track upgrade (group → individual).

## 4. Channels (phased to the go-live gate)

- **Phase 0 — now (pre-go-live, organic):** SEO foundation + technical audit of public pages; content via existing blog; **collect testimonials**; build email list; mosque/community + influencer outreach; design referral program; finalize the open decisions (below).
- **Phase 1 — at go-live (paid on):** branded + intent paid search; Meta/TikTok short-form; **retarget `/pricing` visitors**; launch email to the list; PR to Arabic + diaspora communities.
- **Phase 2 — scale:** programmatic SEO (per-surah/juz + per-teacher pages), partnerships, offer/paywall A/B tests, ASO if a store app ships.

## 5. Offers (only within real policy — no fabrication)

- **Entry offer = the paid assessment session** (set a low, confirmed price — currently seeds at $0).
- **Family/sibling discount** (confirm final % — seeded 10/10 as placeholder).
- **Recommended NEW:** an **annual plan** (price anchor + cash flow + retention) — needs a Stripe annual price added.
- **Do NOT** advertise free trial / money-back / cancel-anytime-self-serve unless the policy actually changes.

## 6. KPIs

- **Acquisition:** sessions, `/pricing` view→CVR, assessment-session bookings.
- **Conversion:** visit → assessment → subscription; checkout completion rate.
- **Retention:** month-2 / month-3 retention, credit utilization, churn + `past_due` recovery rate.
- **Unit economics:** CAC vs LTV by track (ARPU $12–$80/mo); family-account expansion.

## 7. Launch sequence

1. **Pre-launch:** close go-live blockers (refund ownership, Stripe cutover); add self-serve cancel + missed-session makeup; collect 5–10 testimonials; finalize discount % + assessment price.
2. **Launch week:** email list + social + PR; referral program live.
3. **Post-launch:** turn on paid once cutover is done; iterate `/pricing` + the assessment offer; begin programmatic SEO.

## 8. This-week actions (concrete)

- [ ] Owner provides the **4 open decisions** (testimonials, refund policy, discount %, assessment price) — see `.agents/product-marketing.md`.
- [ ] Decide **self-serve cancel** + **missed-session makeup** (conversion + go-live).
- [ ] Ship **social-proof strip + finalized FAQ** (PR #507 follow-up) once testimonials arrive.
- [ ] Run an **SEO audit** of the public pages (`/`, `/pricing`, `/courses`, `/teach-with-us`).
- [ ] Add an **annual plan** (Stripe price + tier) as a price anchor — decision needed.

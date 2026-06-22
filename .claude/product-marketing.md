# furqan.today — Product Marketing Context (source of truth)

> Auto-read by CRO/marketing skills. Keep factual. Prices/policies cite specs + code; if you
> change a plan or policy, update this file in the same PR. Last verified: 2026-06-22.

## Product

Online **Quran-memorization (hifz)** platform. Business model = **monthly recurring subscriptions**
(Stripe) + one-time courses/single-sessions. Replaces the legacy per-session-booking model.
Delivery: **live video** sessions (Daily.co). Fully bilingual **Arabic/English, RTL-first**.

Two sellable hifz tracks on the live pricing page:
- **حلقة جماعية / Group hifz** — structured memorization in a small group.
- **جلسة فردية / Individual hifz** — private 1:1 with a specialist.

Rule: a student holds **at most one active hifz product** at a time (group OR individual OR a defined course).

## Plans & prices (AUTHORITATIVE — live page, seed migration, and Stripe bootstrap all agree)

All `recurring_monthly`, **USD only**, 60-min sessions, active. Middle tier of each track = "الأكثر طلباً / Most popular".

| Track | plan_code | Price/mo | Credits/mo |
|---|---|---|---|
| Group | `hifz_group_4` | **$12** | 4 sessions |
| Group | `hifz_group_6` | **$15** | 6 sessions |
| Group | `hifz_group_8` | **$20** | 8 sessions |
| Individual | `hifz_individual_4h` | **$40** | 4 sessions (sold as "hours") |
| Individual | `hifz_individual_6h` | **$60** | 6 sessions |
| Individual | `hifz_individual_8h` | **$80** | 8 sessions |

Individual basis = **$10/session-hour** (`hifz_individual_hourly_rate_usd=10`). Group prices are settings too.
⚠️ Individual is sold as "N hours/month" but modeled as **discrete 60-min sessions** (bundles of 4/6/8), not continuous hours — keep copy honest.

## Billing model

- Monthly Stripe subscription; first `invoice.paid` activates, later ones renew.
- Each cycle grants exactly `monthly_credit_count` credits, **idempotent** per `(subscription_id, billing_cycle_key)`.
- Credits are **additive — never reset/overwritten**; tier terms frozen at grant time.
- **Upgrade** (same category, more sessions): immediate, prorated (`always_invoice`), delta credits added.
- **Downgrade / type-change**: deferred to next renewal (`pending_tier_changes`, one pending per sub).
- **Failed payment**: → `past_due`, no credits, seat kept, alert; canceled at period end only after Stripe retries exhausted (graceful dunning).
- **Family discounts** (seeded **10%/10%**, NOT FINAL — admin must confirm): 2nd+ individual hifz per guardian; sibling group hifz. Don't stack.
- Checkout returns **409** if the student already has an active hifz subscription.

## Policies (current, public-facing — confirmed by owner 2026-06-22)

- **Trial:** a **paid** trial/assessment session (specialist-matched). **No free subscription trial.** (Assessment price seeds at $0 until admin sets it.)
- **Cancellation:** **via support** (no in-app self-cancel route exists yet; Stripe Customer Portal is the spec intent). Public copy: "Monthly, no long-term contract."
- **Refunds:** **case-by-case via support** — no automated refund path. ⚠️ Single-session charge-but-unserved refund ownership is **undefined and BLOCKING for go-live** (spec 022).
- **Missed session:** **counts toward the plan, not made up.** (Conversion-negative — consider a makeup/reschedule policy.)

## Positioning / trust

- **Teachers hold Ijazah; CVs reviewed before approval** — the #1 trust driver.
- Differentiators (from specs): specialist-matched assessment ("try before commit"), family/guardian accounts with sibling discounts, **progress merged-never-overwritten** (memorization integrity is sacred), flexible scheduling across time zones, live video, full RTL/Arabic.

## DO NOT market as live yet (gaps — see spec citations)

- **Defined memorization courses** & **tajweed/mutoon courses** exist in schema but are **not on the live pricing page**; tajweed pricing is **undocumented**. Don't sell them as available.
- **Stripe is still in test/cutover** — live key flip + data migration (spec 024) pending; gated on the refund-ownership + balance-conversion decisions.
- "Same-teacher upgrade" rule is **spec-only, not enforced** in code.
- Family discount % and assessment price are **placeholders** until an admin confirms.

## Open decisions to get from the owner (don't invent)

1. Real **testimonials / student count / teacher count** for social proof.
2. Final **refund** policy + the single-session unserved-refund owner (go-live blocker).
3. Final **family discount %** and **assessment session price**.
4. Whether to add **self-serve cancel** and **missed-session makeup** (both lift conversion).

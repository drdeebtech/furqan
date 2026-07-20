# furqan.today — Product Marketing Context (source of truth)

> Auto-read by CRO/marketing skills. Keep factual. Prices/policies cite specs + code; if you
> change a plan or policy, update this file in the same PR. Last verified: 2026-07-20.

## Product

Online **Quran-memorization (hifz)** platform. Business model = **monthly recurring subscriptions**
(Stripe) + one-time courses/single-sessions. Subscriptions are the **primary** model, not a
wholesale replacement: per-session / on-demand booking stays available for enrolled students and
instant sessions (teacher hourly rate shown on cards) — **both pricing systems stay public** per
pivot decision #42 (see `src/lib/copy/policies.ts` `PRICING_MODEL`).
Delivery: **live video** sessions (Daily.co). Fully bilingual **Arabic/English, RTL-first**.

Two sellable hifz tracks on the live pricing page:
- **حلقة جماعية / Group hifz** — structured memorization in a small group.
- **جلسة فردية / Individual hifz** — private 1:1 with a specialist.

Rule: a student holds **at most one active hifz product** at a time (group OR individual OR a defined course).

## Plans & prices (AUTHORITATIVE, pre-go-live — live page, seed migration, and Stripe bootstrap all agree)

> Prices are authoritative as live-page content. "Authoritative" here means the three sources agree — it does **not** mean go-live-ready: Stripe cutover and refund-ownership are still open (see "DO NOT market as live yet" below).

All `recurring_monthly`, **USD only**, 60-min sessions, active. Middle tier of each track = "الأكثر طلباً / Most popular".

| Track | plan_code | Price/mo | Credits/mo | Per session |
|---|---|---|---|---|
| Group | `hifz_group_4` | **$12** | 4 sessions | $3.00 |
| Group | `hifz_group_6` | **$15** | 6 sessions | $2.50 |
| Group | `hifz_group_8` | **$18** | 8 sessions | $2.25 |
| Individual | `hifz_individual_4h` | **$44** | 4 sessions (sold as "hours") | $11.00 |
| Individual | `hifz_individual_6h` | **$60** | 6 sessions | $10.00 |
| Individual | `hifz_individual_8h` | **$72** | 8 sessions | $9.00 |

**Per-session price falls as the tier grows, in both tracks** — that is the point of the ladder, and it is
asserted in the DB, not just written here (migration `20260817000000_hifz_price_ladder.sql`). Every
individual tier also undercuts the $14/hr pay-as-you-go rate, so subscribing is always the cheaper way
to buy the same hour. Set 2026-07-20; before this the ladder was flat ($10.00/session at every
individual tier) and group actually got *more* expensive at the margin.

⚠️ There is **no single "individual hourly rate" any more** — price is per tier. The settings keys
`hifz_individual_hourly_rate_usd` and `hifz_group_{4,6,8}_price_usd` are **dead** (declared in
`src/lib/settings.ts`, read by nothing) and now disagree with the real prices. `subscription_plans.price_cents`
is the only source of truth; `packages.price_usd` is a derived mirror. Delete the dead keys in a
contract-phase PR.
⚠️ Individual is sold as "N hours/month" but modeled as **discrete 60-min sessions** (bundles of 4/6/8), not continuous hours — keep copy honest.

### Pay as you go — prepaid hours (spec 038; supersedes "hourly not directly purchasable", decision #42)

A **third** purchase option alongside monthly plans and teacher hourly rates: a student buys a bundle of **60-minute individual-session hours** as a one-time Stripe payment and draws them down as they book — no subscription.
- Rate `prepaid_hours_rate_usd` (**$14/hr**, raised from $10 on 2026-07-20); presets `prepaid_hours_preset_sizes` (**[5,10,20]**) + a clamped custom amount (`prepaid_hours_custom_min`/`_max`, **1–100**). Amount is **server-computed** — the client never sends price. This is deliberately **above** every subscription tier's per-session price: pay-as-you-go is priced as the flexibility premium, which is what makes subscribing the cheaper way to buy the same hour. Existing lots are unaffected — `rate_paid_usd` is frozen per lot at purchase (R8), so the change only prices new purchases.
- Stored as an immutable `student_packages` lot (`product_type='prepaid_hours'`), one per purchase; balance = `sessions_remaining`; append-only `prepaid_hours_events` ledger.
- **Expiry** `prepaid_hours_expiry_months` (**12mo** seed) — copy never hardcodes the window; the wallet shows the exact per-lot date.
- **Drawdown** is subscription-first by default (R2); the student may pick **"use my hours"** per booking (`bookings.use_prepaid_hours`), which charges prepaid **only** (or fails closed — never a silent subscription charge). 60-min unit only.
- **Feature-flagged** `prepaid_hours_purchase_enabled` (default **OFF** — the /pricing card and checkout are invisible until an admin flips it). Flag + knobs read anon-safe via `getSettings()` on the public page.

## Billing model

- Monthly Stripe subscription; first `invoice.paid` activates, later ones renew.
- Each cycle grants exactly `monthly_credit_count` credits, **idempotent** per `(subscription_id, billing_cycle_key)`.
- Credits are **additive — never reset/overwritten**; tier terms frozen at grant time.
- **Upgrade** (same category, more sessions): immediate, prorated (`always_invoice`), delta credits added.
- **Downgrade / type-change**: deferred to next renewal (`pending_tier_changes`, one pending per sub).
- **Failed payment**: → `past_due`, no credits, seat kept, alert; canceled at period end only after Stripe retries exhausted (graceful dunning).
- **Family discounts** (seeded **10%/10%**, % NOT FINAL — admin-configurable, may be tiered by child count): (a) 2nd+ **individual** hifz subscription per guardian; (b) sibling **group** hifz. Applied **per subscription — at most one family discount per subscription, never compounded on one line**. The two rules cover different products, so a guardian may benefit from both across different children/subscriptions. **Promo/coupon codes are deferred post-launch** (pivot decision #36) — family discounts are the only discounts at launch, so nothing stacks with a promo code (none exist yet).
- Checkout returns **409** if the student already has an active hifz subscription.

## Policies (current, public-facing — confirmed by owner 2026-06-22)

- **Trial:** a **free 30-min evaluation session** (تقييم) — specialist-matched, **one per student**, **booked and confirmed via WhatsApp**, framed as a **placement, not a full lesson**. **No free subscription trial and no free teaching lessons** (live teacher time is never free). Free + 30-min per pivot decision #40 (2026-07-02), which **supersedes** the earlier 15-min call (2026-06-22); DB seed $0, hardcoded 30-min duration. Source of truth: `src/lib/copy/policies.ts` (`TRIAL_POLICY`). May revisit to a small paid fee once testimonials + funnel are proven.
- **Cancellation:** **via support** (no in-app self-cancel route exists yet; Stripe Customer Portal is the spec intent). Public copy: "Monthly, no long-term contract."
- **Refunds:** **case-by-case via support** — no automated refund path. ⚠️ Single-session charge-but-unserved refund ownership is **undefined and BLOCKING for go-live** (spec 022).
- **Missed session:** **excused** absence (≥2h notice, **teacher approves**) → **rescheduled at no cost**; **unexcused** (no adequate notice) → **counts toward the plan**; **teacher-absent / excused-carried** → **credit restored, not counted against the student** (enforced in `finalize_attendance`). Public copy must mirror `src/lib/copy/policies.ts` (`ABSENCE_POLICY`) — the flat "not made up" line was inaccurate. (Self-serve makeup/reschedule for the unexcused case is still a conversion consideration.)

## Positioning / trust

- **Teachers hold Ijazah; CVs reviewed before approval** — the #1 trust driver.
- Differentiators (from specs): specialist-matched assessment ("try before commit"), family/guardian accounts with sibling discounts, **progress merged-never-overwritten** (memorization integrity is sacred), flexible scheduling across time zones, live video, full RTL/Arabic.

## DO NOT market as live yet (gaps — see spec citations)

- **Defined memorization courses** & **tajweed/mutoon courses** exist in schema but are **not on the live pricing page**; tajweed pricing is **undocumented**. Don't sell them as available.
- **Stripe is still in test/cutover** — live key flip + data migration (spec 024) pending; gated on the refund-ownership + balance-conversion decisions.
- "Same-teacher upgrade" rule is **spec-only, not enforced** in code.
- Family discount % is a **placeholder** until an admin confirms.

## Open decisions to get from the owner (don't invent)

1. Real **testimonials / student count / teacher count** for social proof.
2. Final **refund** policy + the single-session unserved-refund owner (go-live blocker).
3. Final **family discount %**. (Assessment session = **free 30-min evaluation**, one per student — pivot decision #40, 2026-07-02, supersedes the earlier 15-min call.)
4. Whether to add **self-serve cancel** and **missed-session makeup** (both lift conversion).

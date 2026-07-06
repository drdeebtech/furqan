# Feature Specification: Prepaid Hour Wallet (Pay-as-you-go)

**Spec:** 038 · **Status:** Draft · **Created:** 2026-07-06
**Owner decision source:** issue #654 (individual pricing: flexible hourly vs fixed bundles) — resolved to **offer both**.

## Summary

Give students a third, freely-mixable way to pay for **individual (1:1)** hifz: a **prepaid hour wallet**.
The student buys a bundle of hours upfront (one-time Stripe payment at a flat `$10/session-hour`), then
draws the hours down as they book individual sessions. This runs **alongside** the existing fixed monthly
plans (group + individual subscriptions); a student may hold a plan, a wallet, both, or neither.

This does **not** replace subscriptions and does **not** touch subscription credits. It surfaces and extends
the already-built one-time-payment / single-session machinery into a self-serve, prepaid balance.

### Three lenses (per AGENTS.md §1)

- 🛠 **Engineer:** reuse the tested credit ledger + one-time Stripe payment path; new surface = expiry + refund. Money path is atomic, idempotent, fail-closed, RLS-guarded, locally verified.
- 📖 **Quran teacher:** wallet hours book real 1:1 specialist time; no change to memorization/progress integrity (`deduct` never resets progress). Group halaqat unchanged.
- 🎓 **Teaching-platform expert:** "pay however you want" removes a commitment barrier; honest bilingual RTL copy for rate, expiry, and refund so no student is surprised.

## Decisions (locked with owner, 2026-07-06)

| # | Decision |
|---|---|
| D1 | Wallet **coexists** with plans. It is a separate on-demand balance (like today's instant/single sessions); it **never** touches `subscription` credits and is **not** subject to the "one active hifz product" rule. |
| D2 | Wallet hours are spendable on **individual 1:1 sessions only**. Group halaqat stay subscription-only. |
| D3 | Price = flat **`$10/session-hour`** (admin setting `prepaid_hours_rate_usd`, seeded 10). Presets **5 / 10 / 20** hours + a **custom** quantity (min/max are settings). |
| D4 | **Refund:** unused hours are refundable **on request via support (manual, admin-approved)**, pro-rated at the paid rate, via Stripe refund. No automated self-serve refund. Teacher-no-show restores the hour automatically (existing behavior). |
| D5 | **Expiry:** admin-set window `prepaid_hours_expiry_months` (default **12**), **rolling** — the wallet's `expires_at` resets to `now + window` on every purchase or drawdown. Only fully-dormant balances expire. A pre-expiry reminder is sent. |
| D6 | All of the above (rate, expiry, refund, "pay as you go") is **announced on the pricing + marketing site**, bilingual AR/EN, RTL, sourced from `src/lib/copy/policies.ts`. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Buy a wallet (Priority: P1)

A logged-in student picks "Pay as you go" on `/pricing`, chooses 10 hours (or a custom amount), and completes
a one-time Stripe checkout. On payment success their wallet shows 10 hours with an expiry date.

**Acceptance:**
- Checkout is Stripe `mode:"payment"` (one-time), amount = `hours × prepaid_hours_rate_usd`, computed **server-side** (never from client input).
- Grant is **idempotent per Stripe payment intent** — a webhook redelivery never double-grants.
- Wallet balance and `expires_at` (= `now + expiry window`) are visible to the student immediately after redirect.
- A student **without** any subscription can buy a wallet (no active-hifz-product block).

### User Story 2 — Book an individual session with wallet hours (Priority: P1)

A student with wallet hours books a 1:1 session with a specialist. One hour is drawn down atomically at
confirmation; the wallet `expires_at` rolls forward.

**Acceptance:**
- Booking reuses the existing individual-session precondition; a **live (non-expired)** wallet package with `credits ≥ 1` satisfies it.
- Drawdown is atomic (reuses `deduct_student_package` semantics); no double-spend under concurrent booking (row lock / `FOR UPDATE`).
- If the student has BOTH a subscription and a wallet, the booking flow makes the source explicit (subscription credit vs wallet hour) — **never silently** drains the wallet when a plan credit was intended. Source-selection rule is defined in `data model / drawdown order` below.
- Drawdown resets the wallet `expires_at` to `now + window` (rolling).

### User Story 3 — Teacher no-show restores the hour (Priority: P2)

If the teacher is absent/excused-carried, the drawn hour is returned to the wallet, not lost.

**Acceptance:**
- `finalize_attendance` restores the exact wallet package charged, idempotent via the existing `credit_action='restored'` flip (already built for subscription credits; must also cover `prepaid_hours` packages).

### User Story 4 — Hours expire when dormant (Priority: P2)

A student who neither buys nor books for the full window has their remaining hours expire; they get a reminder first.

**Acceptance:**
- A scheduled sweep voids `credits` on wallet packages where `expires_at < now` (records the void in the ledger; never deletes history).
- The booking precondition **ignores expired packages** even before the sweep runs (defense in depth — expiry is enforced by `expires_at`, not only by the sweep).
- A pre-expiry reminder (n8n) fires at a configurable lead time (e.g. 14 days before `expires_at`).

### User Story 5 — Refund unused hours on request (Priority: P2)

A student asks support to refund unused hours; an admin approves; a pro-rated Stripe refund is issued and the hours are voided.

**Acceptance:**
- Admin-only action; refund amount = `unused_hours × rate_paid` (rate is **frozen at purchase time** on the package, not the current setting).
- Stripe refund is issued against the original payment intent; the refunded hours are voided in the ledger idempotently (a repeated approval never double-refunds).
- Refund is blocked if hours were already spent below the requested amount.

### Edge Cases

- Client tampers with hours/price in the checkout request → server recomputes; mismatch rejected (fail-closed).
- Webhook arrives before/without a matching pending purchase row → handled like the existing single-session payment path (create-or-reconcile, idempotent).
- Concurrent booking spends the last hour twice → row lock prevents oversell; second booking fails the precondition.
- Buying more hours on an expired-but-not-yet-swept wallet → treat as reactivation: new `expires_at = now + window`, credits add to remaining (or to 0 if swept). Additive-never-reset preserved.
- Partial refund then continue booking → remaining balance stays consistent; frozen rate unaffected.
- A student holds subscription + wallet; teacher-absent on a subscription session must **not** restore into the wallet, and vice versa (restore targets the exact package charged).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** Add a self-serve "Pay as you go — buy hours" purchase path (public `/pricing`, and optionally teacher card) for authenticated students.
- **FR-002** Server computes price = `hours × prepaid_hours_rate_usd`; reject any client-supplied amount.
- **FR-003** One-time Stripe `mode:"payment"` checkout; grant wallet on `payment` success, **idempotent per payment intent**.
- **FR-004** Model the wallet as a `student_packages` row (`product_type='prepaid_hours'`, `credits=hours`, `rate_paid_usd`, `expires_at`, `source='one_time'`). RLS + policies ship in the same migration.
- **FR-005** Individual-session booking accepts a live wallet package as the credit source and draws down one hour atomically.
- **FR-006** Wallet drawdown and purchase both reset `expires_at = now + prepaid_hours_expiry_months` (rolling).
- **FR-007** `finalize_attendance` restores wallet hours on teacher-absent / excused-carried (extend the existing restore to `prepaid_hours`).
- **FR-008** Booking precondition treats `expires_at < now` packages as unusable.
- **FR-009** Scheduled sweep voids expired wallet credits and records the void in the ledger.
- **FR-010** Pre-expiry reminder via n8n at a configurable lead time.
- **FR-011** Admin-approved, support-initiated pro-rated Stripe refund of unused hours; idempotent; rate frozen at purchase.
- **FR-012** Settings (admin-editable, seeded): `prepaid_hours_rate_usd=10`, `prepaid_hours_expiry_months=12`, preset sizes, min/max custom, reminder lead days.
- **FR-013** Policy copy (rate, expiry, refund, "pay as you go") added to `src/lib/copy/policies.ts` (AR/EN, short+long) and surfaced on `/pricing` + FAQ; `product-marketing.md` + `docs/marketing-plan.md` updated in the same PR.
- **FR-014** Wallet balance + expiry visible on the student dashboard; purchase and drawdown history in the ledger view.

### Non-Functional / Guardrails

- **NFR-001** All money mutations atomic, idempotent, fail-closed; `userId` from session only (never input).
- **NFR-002** Expand/contract migrations only (no drop/rename/narrow; new columns nullable or defaulted). RLS on every new table/policy.
- **NFR-003** SECURITY DEFINER grant/debit/refund functions: `EXECUTE` revoked from `anon`/`authenticated` (per repo lockdown pattern).
- **NFR-004** Local Postgres verification of purchase → book → teacher-absent restore → expire → refund, run several cycles, before "done".
- **NFR-005** Full RTL/Arabic for every new surface; verified by screenshot, not accessibility tree.
- **NFR-006** No secrets client-side; Stripe secret + service role stay server-only.

### Key Entities

- **Wallet package** — a `student_packages` row: `student_id`, `product_type='prepaid_hours'`, `credits` (hours remaining), `rate_paid_usd` (frozen), `expires_at`, `source`, `stripe_payment_intent_id` (idempotency key), timestamps.
- **Purchase/grant event** — ledger entry recording the one-time payment → hours granted (idempotent per payment intent).
- **Drawdown / restore / void / refund events** — ledger entries (reuse existing `credit_action` vocabulary: `deducted` / `restored` + new `expired` / `refunded`).
- **Settings** — the admin-editable money knobs (FR-012).

### Drawdown order (subscription + wallet held together)

When a student holds both an active subscription and a wallet and books an **individual** session:
1. If the session is covered by the subscription's monthly credits → use a **subscription credit** (default).
2. Only use a **wallet hour** when there is no eligible subscription credit, **or** the student explicitly chooses "use my hours".
Never silently spend a wallet hour when a subscription credit was available and intended. The exact default is confirmed during planning against how the current individual-plan booking selects its credit source.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- A student with no subscription can buy hours and book a 1:1 session end-to-end (test mode).
- Zero double-grants under webhook redelivery; zero double-spend under concurrent booking (proven in local verification).
- Teacher-absent restores a wallet hour exactly once.
- Expired dormant hours are voided and cannot be spent; active students never lose hours (rolling window).
- Refund path issues one Stripe refund and voids the exact unused hours, idempotently.
- `/pricing` shows three honest options; policy copy matches code (single source `policies.ts`); AR/EN RTL correct by screenshot.
- `npm run build`, `tsc`, `lint`, `test:unit` green; new money logic covered by unit + local DB verification.

## Assumptions

- The one-time Stripe `mode:"payment"` path (`checkout/single-session/route.ts`) and its webhook handler are the reuse base; exact adaptation confirmed during planning via `gitnexus_impact`.
- The `student_packages` credit ledger (`deduct_student_package`, `finalize_attendance` restore) is live and is the correct home for wallet balances (confirmed by migration `20260708000000` referencing it).
- Stripe remains in **test/cutover** for this build; go-live flip is out of scope (spec 024).
- Refund workflow reuses admin tooling patterns; exact admin surface confirmed during planning.
- This feature reopens pivot decision #42's "hourly not directly purchasable online" — that copy is intentionally superseded here.

## Out of Scope

- Group halaqa via wallet hours (D2).
- Automated self-serve refunds or self-serve cancel (support-only, D4).
- Volume-discount pricing tiers (flat rate, D3).
- Stripe live-key cutover / data migration (spec 024).
- Coupon/promo codes (pivot decision #36, deferred).

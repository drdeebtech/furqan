# Quickstart Test Scenarios: Product Catalog + Credit/Package Redesign (Spec 019)

**Phase**: م٢ | **Generated**: 2026-06-16

These 5 scenarios define acceptance criteria for spec 019. Each describes what to set up, what
action to take, and what outcome to verify. No seeding scripts are prescribed — implementation
may use Supabase Studio, SQL console, or test fixtures. All monetary values referenced are
illustrative; the actual values in assertions must come from the DB or `platform_settings`, not
from hardcoded numbers in the test.

---

## Scenario 1 — Catalog renders correctly

**Goal**: Verify that `GET /api/catalog/hifz` returns all active catalog tiers with DB-sourced
prices, and omits inactive tiers.

**Setup**:
1. In `packages`, ensure 3 rows with `product_category = 'hifz_group'` and `is_active = true`,
   one for each of the group tiers (4, 6, and 8 sessions per month at their respective prices
   from `platform_settings`).
2. Ensure 3 rows with `product_category = 'hifz_individual'` and `is_active = true`, one for
   each individual bundle (4, 6, and 8 hours per month, priced from the hourly rate setting).
3. Add one additional `packages` row with `is_active = false` (any type) to confirm filtering.

**Action**: Call `GET /api/catalog/hifz` with a valid authenticated session.

**Verify**:
- The response contains exactly 6 tiers (all active hifz rows, none from other categories).
- The inactive package is absent from the response.
- Each tier's `price_usd` in the response matches the corresponding `packages.price_usd` value
  in the database — no hardcoded price appears in the API handler.
- Group tiers appear before individual tiers in the response order.
- No tier has a null or zero `sessions_per_month`.

---

## Scenario 2 — Single-active-hifz constraint prevents a second active subscription

**Goal**: Verify that the partial unique index on `subscriptions` prevents inserting a second
active hifz subscription for the same student.

**Setup**:
1. Create a student profile.
2. Insert a `subscriptions` row for that student with `is_hifz = true` and
   `status = 'active'`.

**Action (first, happy path)**: Attempt to subscribe the same student to a second hifz plan by
inserting another `subscriptions` row with `is_hifz = true` and any non-cancelled status
(e.g. `'active'` or `'incomplete'`).

**Verify (DB layer)**:
- The insert fails with a unique constraint violation on `uix_subscriptions_one_active_hifz`.
- No second subscription row exists for that student with `is_hifz = true` and an active status.

**Action (negative test)**: Insert a second row with `is_hifz = true` and `status = 'canceled'`.

**Verify**:
- The insert succeeds — cancelled subscriptions are outside the partial index filter and do not
  block a new cancelled row.

**Action (API layer)**: Call `POST /api/subscriptions` (spec 018 endpoint) for the same student
with a hifz plan while their first subscription is active.

**Verify**:
- The response is `409 Conflict` with a clear error message.
- The API does not swallow the DB constraint error as a 500.

---

## Scenario 3 — Monthly credit grant is additive; prior unused sessions are not overwritten

**Goal**: Verify that a new billing-cycle grant inserts a fresh `student_packages` row rather
than modifying the prior cycle's row, and that the student's effective session balance is the
sum across both rows.

**Setup**:
1. Create a student profile and an active hifz individual subscription (e.g. 8 sessions/month).
2. Insert a `student_packages` row representing the prior cycle: `sessions_total = 8`,
   `sessions_used = 6`, `status = 'active'`. Record this row's `id`.

**Action**: Simulate the `invoice.paid` webhook for the new billing cycle. This should trigger the
grant function, which inserts a new `student_packages` row with `sessions_total = 8`,
`sessions_used = 0`, and a `billing_cycle_key` matching the new Stripe invoice ID.

**Verify**:
- The prior row (`sessions_used = 6`) is unmodified — `sessions_total`, `sessions_used`, and
  `status` are identical to the values set in Setup step 2.
- A new row exists with `sessions_total = 8`, `sessions_used = 0`, linked to the same
  `subscription_id`.
- The student's effective available balance = `(8 - 6) + (8 - 0) = 10` sessions
  (sum of `sessions_remaining` across active rows).
- Triggering the webhook a second time with the same invoice ID does not insert a duplicate row
  (the `uix_student_packages_cycle_grant` unique index rejects it silently via `ON CONFLICT DO NOTHING`
  or equivalent).

---

## Scenario 4 — Guardian second-subscription discount is recorded and applied

**Goal**: Verify that when a guardian subscribes a second child to an individual hifz plan, the
configured discount is applied and an audit record is written.

**Setup**:
1. In `platform_settings`, set `hifz_second_individual_discount_pct` to a non-zero value
   (e.g. `"10"`).
2. Create a guardian profile and two child profiles, linked via `guardian_children`.
3. Subscribe child A to an individual hifz plan at full price. Verify no discount record is created
   for child A's subscription (first subscription, no discount applies).

**Action**: Subscribe child B to an individual hifz plan through the guardian's account.

**Verify**:
- A `subscription_discount_records` row exists with `subscription_id = child_B.subscription_id`,
  `discount_type = 'second_individual'`, `discount_pct` matching the value in `platform_settings`,
  and `setting_key = 'hifz_second_individual_discount_pct'`.
- The Stripe subscription or invoice created for child B reflects a reduced charge. The amount
  charged equals `full_price × (1 - discount_pct / 100)` where both values are read from the DB.
- Child A's subscription has no `subscription_discount_records` row.
- Changing `hifz_second_individual_discount_pct` in `platform_settings` after the fact does NOT
  retroactively alter the `discount_pct` stored in `subscription_discount_records` — the record is
  immutable.

---

## Scenario 5 — Same-type/same-teacher immediate upgrade grants delta credits additively

**Goal**: Verify that upgrading from a lower individual tier to a higher individual tier charges
Stripe proration, grants only the incremental sessions (not the full new tier), and does not
modify the existing `student_packages` row from the current cycle.

**Setup**:
1. Create a student profile on an active individual hifz subscription (e.g. 4 sessions/month).
2. Insert a `student_packages` row for the current cycle: `sessions_total = 4`,
   `sessions_used = 1`, `status = 'active'`. Note this row's `id`.
3. Ensure the higher individual tier (e.g. 6 sessions/month) exists in `packages` with
   `is_active = true` and the same `product_category`.

**Action**: Call `POST /api/subscriptions/upgrade-tier` with `new_package_id` pointing to the
6-sessions-per-month tier.

**Verify**:
- The Stripe subscription is updated to the new price (confirm via Stripe test-mode event log or
  mocked Stripe client in unit tests — `stripe.subscriptions.update` called once with correct params).
- The response includes `delta_sessions_granted = 2` (= 6 - 4) and `effective_at = 'now'`.
- A new `student_packages` row is inserted with `sessions_total = 2` (the delta) and a
  `billing_cycle_key` prefixed `'upgrade_'` followed by the Stripe invoice ID.
- The existing `student_packages` row from Setup step 2 is unmodified (`sessions_total` and
  `sessions_used` are unchanged).
- The student's effective available balance = `(4 - 1) + 2 = 5` sessions.
- Calling the same endpoint a second time (simulate retry) does not grant a duplicate delta — the
  `uix_student_packages_cycle_grant` index blocks the duplicate insert.
- At next renewal, the `invoice.paid` webhook grants the full 6 sessions (not 2), confirming
  that the upgrade grant and the renewal grant are distinct paths.

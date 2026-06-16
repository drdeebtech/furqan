# API Contracts: Product Catalog + Credit/Package Redesign (Spec 019)

**Phase**: م٢ | **Generated**: 2026-06-16
**Cross-references**: `data-model.md` (table schema), `research.md` (R-002 proration, R-003 guardian pattern)

All endpoints require an authenticated session. `userId` is always resolved from the server-side
session via `supabase.auth.getUser()` — never from request input.
All monetary values are read from the database or `platform_settings`; none are hardcoded in
handler logic or response construction.

---

## 1. `GET /api/catalog/hifz`

**Purpose**: Return all active hifz catalog tiers so the student/guardian can choose a subscription plan.

**Auth**: Any authenticated user (student, guardian, admin).

**Response**:

```ts
// zod schema (response)
const HifzTierSchema = z.object({
  id:                       z.string().uuid(),
  name:                     z.string(),
  tier_type:                z.enum(['group', 'individual']),
  sessions_per_month:       z.number().int().positive(),
  session_duration_minutes: z.number().int().positive(),
  price_usd:                z.string(),   // numeric string, e.g. "40.00" — use string to avoid float drift
  plan_id:                  z.string().uuid(),
  package_id:               z.string().uuid(),
})

const CatalogResponse = z.object({
  tiers: z.array(HifzTierSchema),
})
```

**Source of prices**: `packages.price_usd` column (read from DB). Never hardcoded.
Prices for individual bundles are derived at product-creation time from
`platform_settings.hifz_individual_hourly_rate_usd × sessions_per_month_as_hours`.
They are stored on `packages.price_usd` at catalog-seed time; the API reads stored values.

**Errors**:
- `401 Unauthorized` — no valid session.

**Notes**:
- Filters to `packages.is_active = true AND packages.is_hifz_product = true`.
- Ordered by `tier_type` (group first), then `sessions_per_month` ascending.
- This endpoint does NOT apply guardian discounts — discount calculation happens at checkout
  (`POST /api/subscriptions`), where guardian context is known.

---

## 2. `POST /api/subscriptions/upgrade-tier`

**Purpose**: Immediately upgrade a student's active hifz subscription to a higher tier, subject to
same-type + same-teacher constraints. Triggers Stripe proration; grants delta credits additively.

**Auth**: Authenticated student only. `userId` from session.

**Request**:

```ts
const UpgradeTierRequest = z.object({
  new_package_id: z.string().uuid(),
})
```

**Server-side validation sequence**:
1. Resolve `student_id` from `auth.getUser()`.
2. Fetch the student's single active hifz subscription (status `active` or `past_due`).
   - If none found → `404 Not Found` with `{ error: 'no_active_hifz_subscription' }`.
3. Fetch `packages` row for `new_package_id`. Verify `is_active = true`.
4. Verify `new_package.product_category = current_package.product_category`
   (same type: both group or both individual).
   - If mismatch → `409 Conflict` with `{ error: 'tier_type_mismatch', detail: 'Use schedule-tier-change for type changes.' }`.
5. Verify teacher assignment has not changed (spec 020 field on subscription — skip check if field
   absent in this phase, note in response).
   - If mismatch → `409 Conflict` with `{ error: 'teacher_mismatch' }`.
6. Verify `new_package.sessions_per_month > current_package.sessions_per_month`
   (upgrades only; downgrades must use `schedule-tier-change`).
   - If not → `409 Conflict` with `{ error: 'not_an_upgrade' }`.
7. Call `stripe.subscriptions.update(stripe_subscription_id, { items: [...], proration_behavior: 'create_prorations' })`.
8. Compute `delta_sessions = new_package.sessions_per_month - current_package.sessions_per_month`.
   Insert a new `student_packages` row with `sessions_total = delta_sessions`, linked to
   `subscription_id` and `billing_cycle_key = 'upgrade_' + stripe_invoice_id` for idempotency.
   (The full month's grant at renewal is handled by the normal `invoice.paid` webhook — not doubled here.)
9. Update `subscriptions.pending_tier_change_id = NULL` if one existed (upgrade supersedes pending downgrade).

**Response (200)**:

```ts
const UpgradeTierResponse = z.object({
  proration_amount_usd: z.string(),       // as returned by Stripe invoice line amount_due / 100
  delta_sessions_granted: z.number().int(),
  new_package: HifzTierSchema,
  effective_at: z.literal('now'),
  new_subscription_period_end: z.string().datetime(),
})
```

**Errors**:
- `401` — not authenticated.
- `403` — authenticated user is not a student.
- `404` — no active hifz subscription for this student.
- `409` — constraint violation (see step 4–6 above); `error` field names the reason.
- `502` — Stripe call failed; transaction rolled back.

**Idempotency**: The `billing_cycle_key` unique index on `student_packages` prevents double-grants
if the endpoint is called twice before the webhook fires.

---

## 3. `POST /api/subscriptions/schedule-tier-change`

**Purpose**: Defer a tier change (type change, teacher change, or downgrade) to the end of the
current billing cycle. Creates or replaces the student's single pending tier change record.

**Auth**: Authenticated student only.

**Request**:

```ts
const ScheduleTierChangeRequest = z.object({
  new_package_id: z.string().uuid(),
  reason: z.enum(['type_change', 'teacher_change', 'downgrade']),
})
```

**Server-side validation sequence**:
1. Resolve `student_id` from `auth.getUser()`.
2. Fetch the student's active hifz subscription. If none → `404`.
3. Fetch `packages` row for `new_package_id`. Verify `is_active = true`.
4. Validate `reason` matches the actual change:
   - `downgrade`: `new_package.sessions_per_month < current_package.sessions_per_month`.
   - `type_change`: `new_package.product_category != current_package.product_category`.
   - `teacher_change`: teacher field differs (spec 020 concern — accept if field absent in this phase).
   - Any mismatch → `422 Unprocessable` with `{ error: 'reason_mismatch' }`.
5. Upsert `pending_tier_changes` — one pending change per subscription (`subscription_id` FK is unique
   among `status = 'pending'` rows; old pending row is set to `status = 'cancelled'` before insert).
6. Optionally schedule the Stripe subscription's cancellation at period end and re-subscription to the
   new price — if immediate Stripe scheduling is not implemented in this phase, mark as TODO and rely
   on the renewal webhook to apply the change.

**Response (200)**:

```ts
const PendingChangeObject = z.object({
  id:             z.string().uuid(),
  subscription_id: z.string().uuid(),
  new_package_id: z.string().uuid(),
  new_package:    HifzTierSchema,
  reason:         z.enum(['type_change', 'teacher_change', 'downgrade']),
  requested_at:   z.string().datetime(),
  effective_at:   z.string().datetime(),   // = current_period_end from subscriptions table
})

const ScheduleChangeResponse = z.object({
  pending_change: PendingChangeObject,
})
```

**Errors**:
- `401`, `403`, `404` as above.
- `422` — `reason` does not match the actual diff between current and new tier.

---

## 4. `GET /api/guardian/children`

**Purpose**: Return a guardian's linked children with their active subscription summary.

**Auth**: Authenticated user with `role = 'guardian'` (or admin). Verified server-side via
`profiles` row; non-guardian authenticated users receive `403`.

**Response**:

```ts
const ChildSubscriptionSummary = z.object({
  subscription_id:   z.string().uuid(),
  plan_name:         z.string(),
  tier_type:         z.enum(['group', 'individual']),
  status:            z.enum(['active', 'past_due', 'canceled', 'incomplete', 'trialing']),
  current_period_end: z.string().datetime(),
}).nullable()

const ChildProfile = z.object({
  id:                  z.string().uuid(),
  full_name:           z.string(),
  active_subscription: ChildSubscriptionSummary,
})

const GuardianChildrenResponse = z.object({
  children: z.array(ChildProfile),
})
```

**Notes**:
- Joins `guardian_children → profiles → subscriptions` (latest active).
- Returns at most one `active_subscription` per child (the single-active-hifz invariant guarantees
  there is at most one active hifz subscription per student).

**Errors**:
- `401` — not authenticated.
- `403` — authenticated user does not have guardian role.

---

## 5. `POST /api/guardian/add-child`

**Purpose**: Link an existing student profile to this guardian account.

**Auth**: Authenticated user with `role = 'guardian'`.

**Request**:

```ts
const AddChildRequest = z.object({
  child_user_id: z.string().uuid(),
})
```

**Server-side validation sequence**:
1. Resolve `guardian_id` from `auth.getUser()`. Verify `profiles.role = 'guardian'` → else `403`.
2. Verify `child_user_id != guardian_id` → else `422 { error: 'self_link_not_allowed' }`.
3. Fetch `profiles` row for `child_user_id`. Must exist and have `role = 'student'`.
   - Not found → `404 { error: 'child_not_found' }`.
   - Wrong role → `422 { error: 'target_is_not_a_student' }`.
4. Insert `guardian_children (guardian_id, child_user_id)`.
   - Duplicate (already linked) → `409 { error: 'already_linked' }` (caught from UNIQUE violation).

**Response (201)**:

```ts
const AddChildResponse = z.object({
  guardian_id: z.string().uuid(),
  child_id:    z.string().uuid(),
  linked_at:   z.string().datetime(),
})
```

**Errors**:
- `401` — not authenticated.
- `403` — authenticated user is not a guardian.
- `404` — child profile not found.
- `409` — link already exists.
- `422` — self-link or non-student target.

**Security note**: This endpoint must not be callable by students or unrelated guardians. The
`role = 'guardian'` check must be performed server-side, never trusted from request input.

---

## Shared Types

```ts
// Re-used across multiple endpoints
const HifzTierSchema = z.object({
  id:                       z.string().uuid(),
  name:                     z.string(),
  tier_type:                z.enum(['group', 'individual']),
  sessions_per_month:       z.number().int().positive(),
  session_duration_minutes: z.number().int().positive(),
  price_usd:                z.string(),
  plan_id:                  z.string().uuid(),
  package_id:               z.string().uuid(),
})
```

---

## Cross-Spec Dependencies

| Concern | Owner spec |
|---------|-----------|
| `subscription_plans`, `subscriptions`, `stripe_customers` schema | Spec 018 |
| `packages`, `student_packages`, `deduct_package_session` | Existing (extended by Spec 019) |
| Teacher assignment field on subscription | Spec 020 |
| Assessment single-session checkout | Spec 022 |

# Research: Product Catalog + Credit/Package Redesign (Spec 019)

**Phase**: م٢ | **Generated**: 2026-06-16 | **Spec**: `specs/019-catalog-credit-redesign/spec.md`

---

## R-001 — Single-Active-Hifz Enforcement at the DB Layer

**Decision**: Partial unique index on `subscriptions (student_id)` filtered to active hifz subscriptions, using a denormalized `is_hifz boolean` column on `subscriptions` (populated from the linked `subscription_plans.is_hifz_product`).

```sql
-- On subscription_plans (spec 018 table, extended by this spec):
ALTER TABLE subscription_plans ADD COLUMN is_hifz_product boolean NOT NULL DEFAULT false;

-- On subscriptions (spec 018 table, extended by this spec):
ALTER TABLE subscriptions ADD COLUMN is_hifz boolean NOT NULL DEFAULT false;

-- Partial unique index — at most one non-cancelled hifz subscription per student:
CREATE UNIQUE INDEX uix_subscriptions_one_active_hifz
  ON subscriptions (student_id)
  WHERE is_hifz = true
    AND status NOT IN ('canceled', 'incomplete_expired');
```

**Rationale**: Partial unique index is the only DB-layer enforcement that handles concurrent activation attempts. A trigger or application check has a TOCTOU race under concurrent requests. The denormalized `is_hifz` column on `subscriptions` avoids a JOIN to `subscription_plans` in the WHERE predicate (Postgres partial index predicates cannot reference joined tables).

**Scale check (50k users)**: Index is over `subscriptions`, filtered to `is_hifz = true AND status NOT IN (...)`. At 50k students each with one active hifz subscription = 50k rows in the filtered set. B-tree lookup is O(log N) — fully acceptable. Index scans during insert are cheap.

**Alternatives considered**:
- Trigger-based check: races under concurrent transactions, harder to reason about.
- Application-level check before insert: classic TOCTOU race — rejected.
- Separate `hifz_subscriptions` table: would fragment the spec-018 subscription model unnecessarily.

---

## R-002 — Stripe Proration for Mid-Month Individual Tier Upgrades

**Decision**: Use `proration_behavior: 'create_prorated_invoice'` on `stripe.subscriptions.update()`. Stripe computes and charges the proration automatically. The `invoice.paid` webhook for the prorated invoice fires, and we grant additional credits = `tier_B.sessions_per_month - tier_A.sessions_per_month`.

**Mechanics**:
1. Student requests upgrade from tier A (e.g. 4 hrs/month) to tier B (e.g. 6 hrs/month), same type + same teacher.
2. Server calls `stripe.subscriptions.update(subId, { items: [{ id: itemId, price: tierB.stripe_price_id }], proration_behavior: 'create_prorated_invoice' })`.
3. Stripe immediately creates a prorated invoice for `(price_B - price_A) × (days_remaining / days_in_cycle)`.
4. That invoice is paid immediately (if payment method on file) → `invoice.paid` webhook fires.
5. We grant `sessions_additional = tier_B.sessions_per_month - tier_A.sessions_per_month` into a new `student_packages` row for the remainder of the cycle. The grant is tied to the invoice event_id for idempotency.
6. At renewal, the full `tier_B.sessions_per_month` is granted (normal cycle).

**Rationale**: Letting Stripe compute proration avoids manual pro-rata math on our side and correctly handles edge cases (trial credits, credit notes). We only need to handle the grant side: `delta_sessions` for the partial cycle.

**Scale check**: Proration is per-subscription, not fan-out. No scale concern.

**Alternatives considered**:
- `proration_behavior: 'none'`: no charge but also no credit to the learner — unfair.
- Manual proration math + immediate payment: duplicates Stripe logic, error-prone.

---

## R-003 — Guardian/Child Account Pattern in Supabase

**Decision**: Separate join table `guardian_children (guardian_id, child_id, created_at)` with unique constraint on `(guardian_id, child_id)`. Both FKs reference `profiles(id)`. The `stripe_customers` row (spec 018) is owned by the guardian's `user_id`; children's subscriptions have `student_id = child.id` and link to the guardian's Stripe customer via `stripe_customers.user_id = guardian.id`.

```sql
CREATE TABLE guardian_children (
  guardian_id uuid NOT NULL REFERENCES profiles(id),
  child_id    uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, child_id),
  CHECK (guardian_id <> child_id)
);
```

**Rationale**: A join table is more flexible than a `parent_id` column on `profiles`. A student may in theory have multiple guardians (divorced parents, future use). It also avoids NULLs on `profiles` for adults without guardians. The Stripe customer is resolved as: `guardian = SELECT guardian_id FROM guardian_children WHERE child_id = student_id LIMIT 1`, then `stripe_customers WHERE user_id = guardian_id`.

**Scale check**: At 50k students with one guardian each = 50k rows. Index on `child_id` for the student→guardian lookup. Index on `guardian_id` for the guardian's-children list.

**Alternatives considered**:
- `parent_id uuid` on `profiles`: creates NULLs for all adults; doesn't support multiple guardians; mixes roles.
- Separate `guardian_profiles` table: over-engineering; `profiles` already has a `role` column.

---

## R-004 — Additive Credit Merge in `student_packages`

**Decision**: Each paid cycle creates a **new** `student_packages` row. "Additive" means existing rows are never reset or deleted — they accumulate. The student's total available sessions = `SUM(sessions_remaining) WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())`. The existing `sessions_remaining GENERATED ALWAYS AS (sessions_total - sessions_used) STORED` handles per-row balance. `deduct_package_session` already selects the oldest active package first (FIFO), preserving any unused remainder from prior cycles.

**From the schema**:
```sql
-- student_packages
sessions_remaining integer GENERATED ALWAYS AS (sessions_total - sessions_used) STORED
-- Constraint: sessions_used <= sessions_total (cannot go negative)
```

**Verification**: `deduct_package_session(uuid)` selects:
```sql
SELECT id FROM student_packages
WHERE student_id = p_student_id AND status = 'active'
  AND sessions_remaining > 0
ORDER BY purchased_at ASC  -- oldest first (FIFO)
LIMIT 1
FOR UPDATE;
```
This FIFO order naturally "merges" old unused sessions with new grants — the student uses old ones first.

**For spec 019**: Grant landing = `INSERT INTO student_packages (student_id, package_id, payment_id, sessions_total, sessions_used, status, expires_at)` with `sessions_total = tier.sessions_per_month`. Old rows are untouched. No reset.

**Alternatives considered**:
- UPDATE existing row to add sessions: breaks the per-cycle idempotency key (can't use `billing_event.id` as uniqueness if we UPDATE rather than INSERT). Also, updating `sessions_total` while `sessions_remaining` is GENERATED would require a new column pattern. INSERT-per-grant is simpler and already the spec-018 design.

---

## R-005 — `platform_settings` Pattern

**Schema** (from baseline):
```sql
-- platform_settings: key text PK, value text NOT NULL
-- RLS: authenticated SELECT, admin-only INSERT/UPDATE/DELETE (via is_admin() check)
```

**Access pattern** (`src/lib/settings.ts`):
- `getSetting(key)`: public-facing, uses Edge Config fast-path (< 1ms) with Postgres fallback.
- `getSettings()`: cached via `unstable_cache` with `platform-settings` tag, TTL 3600s.
- New keys must be added to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts` for type safety.
- Value is always `text`; caller parses (e.g. `parseFloat(value)`).

**New keys for spec 019**:

| Key | Example value | Description |
|-----|--------------|-------------|
| `hifz_individual_hourly_rate_usd` | `"10.00"` | Per-hour rate for individual hifz bundles |
| `hifz_group_4_price_usd` | `"12.00"` | Group 4-session tier price |
| `hifz_group_6_price_usd` | `"15.00"` | Group 6-session tier price |
| `hifz_group_8_price_usd` | `"20.00"` | Group 8-session tier price |
| `hifz_second_individual_discount_pct` | `"10"` | % discount on 2nd+ individual subscription under same guardian |
| `hifz_sibling_group_discount_pct` | `"10"` | % discount for group hifz sibling (same guardian) |
| `hifz_assessment_price_usd` | `"0.00"` | Assessment session price (0 = free) |
| `hifz_assessment_limit_per_specialty` | `"1"` | Max free assessments per student per specialty |

**Rationale**: `platform_settings` is the established pattern. No code deploy for price changes. Admin edits via admin dashboard → `revalidateTag('platform-settings')` flushes cache.

**Alternatives considered**:
- Hardcoded constants: rejected (spec requirement, NFR-001).
- Separate `price_settings` table: over-engineering; `platform_settings` already serves this role.

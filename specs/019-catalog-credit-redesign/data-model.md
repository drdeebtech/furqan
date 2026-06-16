# Data Model: Product Catalog + Credit/Package Redesign (Spec 019)

**Phase**: م٢ | **Generated**: 2026-06-16

Spec 018 owns: `subscriptions`, `subscription_plans`, `stripe_customers`, `billing_events`.
This spec **extends** those tables and adds: `guardian_children`, `subscription_discount_records`, `pending_tier_changes`, plus migrations that widen `packages.package_type` enum and add linking columns.

---

## 1. Extensions to Spec-018 Tables

### 1a. `subscription_plans` — add `is_hifz_product`

```sql
ALTER TABLE subscription_plans
  ADD COLUMN is_hifz_product boolean NOT NULL DEFAULT false,
  ADD COLUMN sessions_per_month integer,       -- for hifz tiers; NULL for tajweed/one-time
  ADD COLUMN session_duration_min integer;     -- 60 for all current tiers
```

| Column | Type | Notes |
|--------|------|-------|
| `is_hifz_product` | `boolean NOT NULL DEFAULT false` | Drives single-active-hifz index |
| `sessions_per_month` | `integer NULL` | Only set for recurring hifz tiers |
| `session_duration_min` | `integer NULL` | Minutes per session; 60 for all current tiers |

### 1b. `subscriptions` — add `is_hifz` + `pending_change_id`

```sql
ALTER TABLE subscriptions
  ADD COLUMN is_hifz boolean NOT NULL DEFAULT false,
  ADD COLUMN pending_tier_change_id uuid REFERENCES pending_tier_changes(id);
```

**Partial unique index** (enforces single-active-hifz at DB layer):
```sql
CREATE UNIQUE INDEX uix_subscriptions_one_active_hifz
  ON subscriptions (student_id)
  WHERE is_hifz = true
    AND status NOT IN ('canceled', 'incomplete_expired');
```

### 1c. `packages` — widen `package_type` CHECK + add `subscription_plan_id`

New allowed `package_type` values (added to the CHECK constraint):

| Value | Description |
|-------|-------------|
| `hifz_group_4` | Group hifz 4 sessions/month (60 min) |
| `hifz_group_6` | Group hifz 6 sessions/month (60 min) |
| `hifz_group_8` | Group hifz 8 sessions/month (60 min) |
| `hifz_individual_4h` | Individual hifz 4 hrs/month |
| `hifz_individual_6h` | Individual hifz 6 hrs/month |
| `hifz_individual_8h` | Individual hifz 8 hrs/month |
| `tajweed_course` | One-time tajweed/mutoon course |

```sql
ALTER TABLE packages
  ADD COLUMN subscription_plan_id uuid REFERENCES subscription_plans(id),
  ADD COLUMN is_hifz_product boolean NOT NULL DEFAULT false,
  ADD COLUMN product_category text CHECK (product_category IN ('hifz_group','hifz_individual','tajweed_mutoon','other'));

-- Update CHECK on package_type to include new values (DROP + ADD):
ALTER TABLE packages DROP CONSTRAINT packages_package_type_check;
ALTER TABLE packages ADD CONSTRAINT packages_package_type_check
  CHECK (package_type = ANY (ARRAY[
    'single_session','pack_4','pack_8','pack_12','full_course',
    'hifz_group_4','hifz_group_6','hifz_group_8',
    'hifz_individual_4h','hifz_individual_6h','hifz_individual_8h',
    'tajweed_course'
  ]));
```

**Note**: `packages_package_type_key` UNIQUE constraint already exists — each tier = one row. Retained.

### 1d. `student_packages` — add `subscription_id`

```sql
ALTER TABLE student_packages
  ADD COLUMN subscription_id uuid REFERENCES subscriptions(id),
  ADD COLUMN billing_cycle_key text;   -- stripe invoice_id or 'manual_YYYYMM' for idempotency
```

Unique constraint for per-cycle idempotency:
```sql
CREATE UNIQUE INDEX uix_student_packages_cycle_grant
  ON student_packages (subscription_id, billing_cycle_key)
  WHERE billing_cycle_key IS NOT NULL;
```

---

## 2. New Tables

### 2a. `guardian_children`

One guardian manages multiple children's subscriptions. Billing routes through the guardian's `stripe_customers` row.

```sql
CREATE TABLE guardian_children (
  guardian_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, child_id),
  CHECK (guardian_id <> child_id)
);
CREATE INDEX idx_guardian_children_child ON guardian_children (child_id);
```

**RLS**:
- `SELECT`: guardian reads their own rows (`guardian_id = auth.uid()`); student reads their own row (`child_id = auth.uid()`); admin reads all.
- `INSERT/UPDATE/DELETE`: service_role and admin only.

### 2b. `subscription_discount_records`

Immutable audit record of which discount was applied at subscription creation time.

```sql
CREATE TABLE subscription_discount_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id),
  discount_type    text NOT NULL CHECK (discount_type IN ('second_individual','sibling_group')),
  discount_pct     numeric(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  setting_key      text NOT NULL,   -- platform_settings key used (audit trail)
  applied_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_discount_records_subscription ON subscription_discount_records (subscription_id);
```

**RLS**:
- `SELECT`: guardian reads their own (via subscription → student → guardian_children); admin reads all.
- `INSERT`: service_role only (written at subscription creation time).
- `UPDATE/DELETE`: none (immutable ledger).

**BEFORE UPDATE guard**: Add trigger to block any UPDATE (record is write-once).

### 2c. `pending_tier_changes`

Records a tier change deferred to next renewal (type/teacher change, or downgrade).

```sql
CREATE TABLE pending_tier_changes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id      uuid NOT NULL REFERENCES subscriptions(id),
  student_id           uuid NOT NULL REFERENCES profiles(id),
  from_package_id      uuid NOT NULL REFERENCES packages(id),
  to_package_id        uuid NOT NULL REFERENCES packages(id),
  change_reason        text NOT NULL CHECK (change_reason IN ('type_change','teacher_change','downgrade','other')),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  applies_at_period_end boolean NOT NULL DEFAULT true,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','cancelled')),
  applied_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_pending_changes_subscription ON pending_tier_changes (subscription_id) WHERE status = 'pending';
```

**RLS**:
- `SELECT`: student reads their own (`student_id = auth.uid()`); admin reads all.
- `INSERT`: service_role only.
- `UPDATE` on `status`, `applied_at`: service_role only.

**BEFORE UPDATE guard** on `subscription_id`, `student_id`, `from_package_id`, `to_package_id` (identity columns — immutable once created).

---

## 3. Platform Settings Keys (new for this spec)

These rows are seeded in the migration via `INSERT INTO platform_settings (key, value)`:

| Key | Seed value | Type |
|-----|-----------|------|
| `hifz_individual_hourly_rate_usd` | `"10.00"` | decimal |
| `hifz_group_4_price_usd` | `"12.00"` | decimal |
| `hifz_group_6_price_usd` | `"15.00"` | decimal |
| `hifz_group_8_price_usd` | `"20.00"` | decimal |
| `hifz_second_individual_discount_pct` | `"10"` | integer % |
| `hifz_sibling_group_discount_pct` | `"10"` | integer % |
| `hifz_assessment_price_usd` | `"0.00"` | decimal |
| `hifz_assessment_limit_per_specialty` | `"1"` | integer |

Also add these keys to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`.

---

## 4. Entity Relationship Summary

```
profiles ──< guardian_children >── profiles
                                         │
subscriptions ──────────────────── student_id (FK profiles)
    │ is_hifz, pending_tier_change_id
    │
    ├──< subscription_discount_records
    │
    ├── pending_tier_changes (via pending_tier_change_id)
    │
    └── subscription_plans ──── packages (via subscription_plan_id)
                                    │ is_hifz_product, product_category

student_packages ──── subscription_id (FK subscriptions)
                  ──── package_id      (FK packages)
```

---

## 5. Scale Audit (50k users)

| Table | Estimated rows at 50k | Index strategy |
|-------|----------------------|----------------|
| `guardian_children` | ~50k | PK + idx on child_id |
| `subscription_discount_records` | ~50k | idx on subscription_id |
| `pending_tier_changes` | <1k active | Partial idx WHERE status='pending' |
| `packages` (extended) | <20 rows | Tiny — full scan fine |
| `platform_settings` (extended) | <30 rows | Key lookup by PK |

Partial unique index `uix_subscriptions_one_active_hifz` scans ~50k rows on INSERT — B-tree O(log N), acceptable.

---

## 6. Constitution Compliance

| Principle | Status |
|-----------|--------|
| I — Domain Ownership | ✅ New entities live in Package domain; catalog reads in `src/lib/domains/package/` |
| II — Loud Failures | ✅ All mutations via `loudAction`; duplicate-hifz violation surfaces as user-facing error |
| III — Atomic Critical Paths | ✅ Grant + discount-record creation → single SQL function |
| IV — Auth at Boundary | ✅ `student_id` from `auth.getUser()`, never from input |
| V — Tracer-Bullet | ✅ Spec-kit workflow |
| Scale (50k) | ✅ All indexes sized above |
| RLS | ✅ Every new table has policies in same migration |

# Phase 1 — Data Model: Subscription Billing Foundation

All in **one** timestamped migration `supabase/migrations/<UTC ts>_subscription_billing_foundation.sql`, landing after the `20260428000000_remote_baseline.sql` baseline. RLS enabled + policies + financial-column guards **in the same migration** (constitution / AGENTS.md §3). Amounts in integer **cents**, USD only. PK `uuid default gen_random_uuid()`. `created_at`/`updated_at timestamptz` with the existing `public.set_updated_at()` trigger.

## Enums

```sql
CREATE TYPE public.subscription_status AS ENUM
  ('incomplete','active','past_due','canceled','incomplete_expired','unpaid');
CREATE TYPE public.billing_plan_type AS ENUM
  ('recurring_monthly','recurring_limited');   -- limited = fixed-duration course sub (semantics in spec 019)
CREATE TYPE public.billing_event_status AS ENUM
  ('received','processed','ignored','failed');
```

## Table: `subscription_plans` (catalog mirror — binding source of what a cycle grants)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| plan_code | text UNIQUE NOT NULL | stable internal code |
| name | text NOT NULL | display |
| plan_type | billing_plan_type NOT NULL | |
| monthly_credit_count | int NOT NULL CHECK (>= 0) | sessions granted per paid cycle |
| session_metadata | jsonb NOT NULL DEFAULT '{}' | duration/mode sizing (mirrors `student_packages.session_mode_used` shape; tiers → spec 019) |
| price_cents | int NOT NULL CHECK (>= 0) | USD cents |
| currency | text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd') | FR-008 |
| stripe_product_id | text NOT NULL | |
| stripe_price_id | text UNIQUE NOT NULL | binding link |
| is_active | boolean NOT NULL DEFAULT true | |
| created_at / updated_at | timestamptz | |

**RLS**: SELECT to `authenticated` where `is_active` (catalog is public to logged-in users, FR-006). All writes service-role only.
**Index**: `stripe_price_id` (unique), partial `WHERE is_active`.

## Table: `stripe_customers` (1:1 user ↔ Stripe customer)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE | one customer per user |
| stripe_customer_id | text NOT NULL UNIQUE | FR-002 |
| created_at / updated_at | timestamptz | |

**RLS**: SELECT where `( select auth.uid() ) = user_id`. Writes service-role only.
**Race**: dual UNIQUE is the concurrency backstop (research R6).

## Table: `subscriptions` (lifecycle mirror)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | the learner entitled |
| payer_user_id | uuid NULL REFERENCES profiles(id) | guardian paying for child; null = self-pay (one-student scope, FR/Assumptions) |
| plan_id | uuid NOT NULL REFERENCES subscription_plans(id) | |
| stripe_subscription_id | text NOT NULL UNIQUE | FR-001 |
| stripe_customer_id | text NOT NULL | denormalized for portal/recon |
| status | subscription_status NOT NULL | |
| current_period_start | timestamptz NULL | |
| current_period_end | timestamptz NULL | |
| cancel_at_period_end | boolean NOT NULL DEFAULT false | |
| last_event_at | timestamptz NOT NULL DEFAULT 'epoch' | recency guard (research R5) |
| canceled_at | timestamptz NULL | |
| created_at / updated_at | timestamptz | |

**RLS**: SELECT where `( select auth.uid() ) = student_id OR ( select auth.uid() ) = payer_user_id OR private.is_admin()`. Writes service-role only.
**Index**: btree `student_id` (50k-scale RLS), `stripe_subscription_id` (unique), `status` partial for ops dashboards.
**Guard** (`BEFORE UPDATE OF`): lock `student_id, payer_user_id, plan_id, stripe_subscription_id, stripe_customer_id` against client mutation — exempt service_role + null JWT + admin, per the `private.guard_booking_identity_change()` pattern (FR-007).

## Table: `billing_events` (idempotency ledger / audit)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| stripe_event_id | text NOT NULL UNIQUE | **idempotency key** (FR-004) |
| event_type | text NOT NULL | e.g. `invoice.paid` |
| stripe_event_created | timestamptz NOT NULL | for recency ordering |
| subscription_id | uuid NULL REFERENCES subscriptions(id) | |
| stripe_customer_id | text NULL | |
| status | billing_event_status NOT NULL DEFAULT 'received' | |
| error_detail | text NULL | on `failed` |
| payload | jsonb NOT NULL | raw event for audit/replay |
| created_at | timestamptz | |

**RLS**: SELECT `private.is_admin()` only (FR-006). Writes service-role only.
**Index**: `stripe_event_id` (unique), `subscription_id`, `event_type`.
**Growth**: append-only; retention/partition is an ops note, not in scope (plan Scale section).

## Reused tables (NOT modified beyond a grant linkage)

- **`student_packages`** — monthly grant lands here. Add nullable linkage columns **only if needed**: `subscription_id uuid NULL REFERENCES subscriptions(id)` and `billing_cycle_key text NULL` with a **UNIQUE partial index** `WHERE billing_cycle_key IS NOT NULL` (the per-cycle grant-once guarantee, FR-005/R3). Existing columns (`sessions_total`, `sessions_used`, `sessions_remaining` generated, `status`, `expires_at`, `session_mode_used`) are reused unchanged.
- **`payments`** — invoice payment recorded here, reusing `stripe_payment_intent` UNIQUE, `provider='stripe'`, `status` enum, `amount_usd`. No schema change.

## Function: `grant_subscription_cycle(...)` — atomic, idempotent (FR-015, R3/R4)

```
grant_subscription_cycle(
  p_subscription_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_cycle_key text,            -- invoice_id + sub_id + period_start
  p_stripe_payment_intent text,
  p_amount_cents int,
  p_credit_count int,
  p_expires_at timestamptz,
  p_session_metadata jsonb
) RETURNS uuid   -- the student_packages grant id (existing or new)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Behavior (single transaction):
1. If a `student_packages` row already has `billing_cycle_key = p_cycle_key` → return its id (no-op; idempotent).
2. Upsert `payments` on `stripe_payment_intent` (no duplicate payment).
3. Insert `student_packages` grant (`sessions_total = p_credit_count`, `status='active'`, `expires_at`, `subscription_id`, `billing_cycle_key`, `session_mode_used = p_session_metadata`).
4. Return grant id.

**Lockdown** (NFR-002): `REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role;`

## sb:advisors

After applying: `npm run sb:advisors` MUST be clean for all four new tables (RLS present, no SECURITY DEFINER view leaks, no missing-index warnings on the RLS predicate columns).

## Local verification (NFR-003)

Simulate in local Postgres before "done": grant cycle 1 → assert 1 grant + 1 payment; replay same event id → assert still 1/1; renewal cycle 2 distinct `cycle_key` → assert 2 grants; duplicate renewal delivery → assert still 2; out-of-order canceled-then-stale-active → assert mirror stays canceled (R5).

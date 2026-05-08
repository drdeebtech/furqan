# Data Model: Package Deduction Lifecycle (دورة حياة الباقة)

**Branch**: `005-package-deduction-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures the existing schema; no new tables, columns, or migrations are introduced by this PR.

---

## Tables in scope

### `public.packages` (catalog, admin-managed)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | Primary key, default `gen_random_uuid()` |
| `package_type` | `text` | NO | CHECK in `(single_session, pack_4, pack_8, pack_12, full_course)` |
| `name` | `text` | NO | English name |
| `name_ar` | `text` | NO | Arabic name |
| `description` | `text` | YES | English description |
| `description_ar` | `text` | YES | Arabic description |
| `session_count` | `integer` | NO | Total sessions granted by this package; default 1 |
| `duration_min` | `integer` | NO | Per-session duration in minutes; default 30 |
| `price_usd` | `numeric` | NO | USD price |
| `price_gbp` | `numeric` | YES | GBP price |
| `price_sar` | `numeric` | YES | Saudi Riyal price |
| `price_aud` | `numeric` | YES | Australian dollar price |
| `features` | `text[]` | YES | English features list |
| `features_ar` | `text[]` | YES | Arabic features list |
| `is_active` | `boolean` | NO | Default `true`; toggled by `togglePackageActive` |
| `is_featured` | `boolean` | NO | Default `false`; admin highlights one or more for marketing |
| `display_order` | `integer` | NO | Default 0; sort key for public listing |
| `created_at` | `timestamptz` | NO | Default `now()` |

**Indexes**:
- Primary key on `id`
- `idx_packages_active_order` on `(is_active, display_order)` — public catalog listing query

**No triggers** for state machine; this is a catalog table, not a state-bearing table.

### `public.student_packages` (per-student subscription, the canonical state)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | Primary key |
| `student_id` | `uuid` | NO | FK → `profiles.id` (role='student') |
| `package_id` | `uuid` | NO | FK → `packages.id`; ON DELETE policy verified in T11 (Phase C) |
| `sessions_total` | `integer` | NO | Snapshot of `packages.session_count` at purchase time |
| `sessions_used` | `integer` | NO | Default 0; incremented by `deduct_package_session()` |
| `mode_counts` | `jsonb` | NO | Default `'{}'`; per-mode counts e.g. `{"private":4,"halaqa":2,"lecture":0}`. Added 2026-05-05 |
| `expires_at` | `timestamptz` | YES | Computed at purchase as `now() + duration interval`; NULL = never expires |
| `status` | `text` | NO | CHECK in `(active, expired, cancelled)`; default `'active'` |
| `cancelled_at` | `timestamptz` | YES | Populated on admin cancel |
| `cancel_reason` | `text` | YES | Freeform per spec.md D-005 |
| `payment_id` | `text` | YES | PayPal capture ID (or future Stripe payment ID) |
| `created_at` | `timestamptz` | NO | Default `now()` |

**Indexes**:
- Primary key on `id`
- `idx_student_packages_student_status` on `(student_id, status)` — student dashboard "my active package" query
- `idx_student_packages_expires_at` on `(expires_at) WHERE status='active'` — n8n expiry-countdown query

**Triggers**: none for state machine — the canonical write path is the SQL function. CHECK constraint on `status` rejects invalid values at column level.

### `public.payments` (PayPal capture log)

Added by `20260501071453_paypal_payments.sql`. Stores one row per PayPal capture event. Foreign-keys back to `student_packages.id`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `student_package_id` | `uuid` | FK → `student_packages.id` |
| `paypal_capture_id` | `text` | Idempotency key from PayPal |
| `amount` | `numeric` | Captured amount |
| `currency` | `text` | One of USD, GBP, SAR, AUD |
| `status` | `text` | `succeeded` / `refunded` / `failed` |
| `captured_at` | `timestamptz` | From PayPal payload |
| `created_at` | `timestamptz` | Default `now()` |

**Idempotency**: unique index on `(paypal_capture_id)` prevents double-fulfillment if the webhook fires twice (PB-03 mitigation).

---

## SQL functions in scope

### `public.deduct_package_session(p_package_id uuid) RETURNS boolean`

```sql
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE student_packages
  SET sessions_used = sessions_used + 1
  WHERE id = p_package_id
    AND status = 'active'
    AND sessions_used < sessions_total
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING true;
$$;
```

Atomic: predicate evaluation and counter increment in one row lock. Returns `true` on success, `null` on predicate failure (caller treats as failure).

### `public.deduct_package_session_mode(p_package_id uuid, p_mode text) RETURNS boolean`

PL/pgSQL companion (per `20260505211356_extend_packages_with_session_modes.sql:77`). Logic sketch:

1. If `mode_counts->>p_mode > 0`: decrement that key in JSONB and return true.
2. Else if `sessions_used < sessions_total`: fall back to `deduct_package_session(p_package_id)` (legacy budget).
3. Else: return false.

Same atomic guarantee inherited from the underlying UPDATE.

---

## Enums / CHECK constraints in scope

### `student_packages.status` (CHECK)

```
active | expired | cancelled
```

Allowed transitions (no DB trigger; enforced by the limited write paths):

```
(insert)        → active
active          → cancelled (admin cancel)
active          → expired (currently never written by application — D-003)
cancelled       → (terminal)
expired         → (terminal)
```

The "exhausted" state is virtual — derived at query time from counters. See spec.md and Decision 2.

### `packages.package_type` (CHECK, NOT enum)

```
single_session | pack_4 | pack_8 | pack_12 | full_course
```

CHECK constraint, not a Postgres ENUM — to allow easier addition of new types via `ALTER TABLE … DROP/ADD CONSTRAINT` rather than the 3-step `ALTER TYPE … ADD VALUE` dance. Cf. constitution Universal Rule #7.

### `packages.is_active` (BOOLEAN, NOT NULL, default true)

Toggled by `togglePackageActive`. Existing `student_packages` rows referencing inactive packages remain valid (catalog deactivation does NOT cascade).

---

## RLS policies in scope

### `packages` (catalog)

- **SELECT**: anonymous (public catalog listing) where `is_active = true`. Authenticated users see all rows for completeness in admin views.
- **INSERT/UPDATE/DELETE**: admin only via `requireRole("admin")` at route adapter; RLS policy `is_admin()`.

### `student_packages` (per-student)

- **SELECT**: student sees own rows (`student_id = auth.uid()`); teacher sees rows for their students (via JOIN through bookings); admin sees all (`is_admin()`).
- **INSERT**: webhook handler (PayPal capture) inserts via service-role client. Admin manual assign also via service-role.
- **UPDATE**: only via `deduct_package_session*()` SECURITY DEFINER functions OR admin cancel path. Direct UPDATEs blocked at RLS level for student callers.
- **DELETE**: not allowed (audit-trail integrity).

**RLS at scale**: `student_packages` will grow to ~3M rows total at 50k DAU × 5 packages × 12 months. Index on `(student_id, status)` keeps the per-student dashboard query under 5ms. ✅

### `payments`

- **SELECT**: student sees own (via JOIN through `student_package_id`); admin sees all.
- **INSERT**: service-role only (webhook handler).
- **UPDATE/DELETE**: admin only, rare (refund accounting).

---

## Cross-spec relationships

### With spec 003 (booking-lifecycle)

- **Read at booking creation**: `createBooking()` (booking domain) reads `student_packages` to verify FR-009 ("Student MUST have remaining sessions in an active package"). Predicate-based — combines `status='active'` AND `sessions_used < sessions_total` AND `expires_at > now()`.
- **Write at terminal completed**: `endSession()` (booking domain) calls `deduct_package_session(package_id)` — the canonical write path.
- **No reverse coupling**: package domain does not read or write to `bookings`.

### With spec 004 (followup-lifecycle)

- No direct coupling. Follow-ups don't deduct sessions.

### With spec 001 (murajaah-scheduler)

- No direct coupling.

### With Communication domain (notify, dispatch)

- n8n low-balance-alert and expiry-countdown workflows read `student_packages` predicate-based; dispatch via `notify()` post-read. Best-effort.

---

## Key entities (cross-reference to spec.md FRs)

- **Package** (`packages` table). FR-009 (catalog management).
- **StudentPackage** (`student_packages` table). FR-001, FR-002, FR-004, FR-005, FR-006, FR-010.
- **Payment** (`payments` table). User Story 1 (acquisition); PB-03 mitigation.
- **DeductionFunctions** (SQL). FR-002, FR-003, FR-008.

---

## Out of scope for this PR

- New columns, indexes, triggers, RLS policies — none in scope.
- Refund-back companion function — D-002 follow-up issue.
- Status='expired' cron or view — D-003 follow-up issue.
- Explicit per-mode fallback prompt — D-004 follow-up issue.
- Stripe checkout integration — deferred per CLAUDE.md.

References:
- `LIFECYCLES.md` §4 — narrative state machine.
- `src/lib/supabase/migrations/v11_001_packages.sql` — canonical schema + deduct_package_session()
- `supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql` — SECURITY DEFINER hardening
- `supabase/migrations/20260501071453_paypal_payments.sql` — payments table
- `supabase/migrations/20260505211356_extend_packages_with_session_modes.sql` — mode_counts + companion function

# Data Model: Onboarding Assessment + Per-Session Single Sessions (Spec 022)

**Phase**: م٥ | **Generated**: 2026-06-16

---

## 1. Migration 1: `20260619000000_payments_booking_id.sql`

```sql
ALTER TABLE payments
  ADD COLUMN booking_id uuid UNIQUE REFERENCES bookings(id);
```

Nullable — existing subscription-funded payments rows unaffected. UNIQUE constraint ensures one-to-one payment↔booking.

---

## 2. Migration 2: `20260619000001_single_session_columns.sql`

```sql
CREATE TYPE specialized_purpose AS ENUM (
  'review',
  'consolidate_surah',
  'memorize_mutoon',
  'test_juz_mutashabihat'
);

ALTER TABLE bookings
  ADD COLUMN booking_product_type text
    CHECK (booking_product_type IN ('assessment','instant','specialized','subscription')),
  ADD COLUMN specialty text,
  ADD COLUMN purpose specialized_purpose,
  ADD COLUMN target_scope jsonb;

-- BEFORE UPDATE OF guard on new identity columns
CREATE OR REPLACE FUNCTION bookings_single_session_identity_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('role') = 'service_role' THEN RETURN NEW; END IF;
  IF private.is_admin() THEN RETURN NEW; END IF;
  IF NEW.booking_product_type IS DISTINCT FROM OLD.booking_product_type THEN
    RAISE EXCEPTION 'booking_product_type is immutable after creation';
  END IF;
  IF NEW.specialty IS DISTINCT FROM OLD.specialty THEN
    RAISE EXCEPTION 'specialty is immutable after creation';
  END IF;
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'purpose is immutable after creation';
  END IF;
  IF NEW.target_scope IS DISTINCT FROM OLD.target_scope THEN
    RAISE EXCEPTION 'target_scope is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_single_session_identity_guard_trigger
  BEFORE UPDATE OF booking_product_type, specialty, purpose, target_scope
  ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_single_session_identity_guard();

-- Seed single-session price settings (admin sets real values)
INSERT INTO platform_settings (key, value) VALUES
  ('single_session_instant_price_usd',            '0.00'),
  ('single_session_assessment_price_usd',          '0.00'),
  ('single_session_review_price_usd',              '0.00'),
  ('single_session_consolidate_surah_price_usd',   '0.00'),
  ('single_session_memorize_mutoon_price_usd',     '0.00'),
  ('single_session_test_juz_price_usd',            '0.00')
ON CONFLICT (key) DO NOTHING;
```

---

## 3. Adapted SECURITY DEFINER Function

### `start_instant_session_booking` (adapted, not replaced)

Add optional `p_payment_id uuid DEFAULT NULL` parameter. When set:
- Sets `bookings.student_package_id = NULL`
- After booking insert: `UPDATE payments SET booking_id = new_booking_id WHERE id = p_payment_id`

Existing package-debit path (when `p_payment_id IS NULL`) is preserved for backward-compat.

SECURITY DEFINER, search_path = public. REVOKE EXECUTE FROM public/anon/authenticated. GRANT EXECUTE TO service_role — unchanged.

---

## 4. New `platform_settings` Keys

Added to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`:

| Key | Seed value | Description |
|-----|-----------|-------------|
| `single_session_instant_price_usd` | `'0.00'` | One-time instant session price |
| `single_session_assessment_price_usd` | `'0.00'` | Assessment session price (0 = free) |
| `single_session_review_price_usd` | `'0.00'` | Review (مراجعة) session price |
| `single_session_consolidate_surah_price_usd` | `'0.00'` | Consolidate-surah session price |
| `single_session_memorize_mutoon_price_usd` | `'0.00'` | Memorize-mutoon session price |
| `single_session_test_juz_price_usd` | `'0.00'` | Test juz/mutashabihat session price |

---

## 5. Reused Tables (no structural changes)

| Table | Role in this spec |
|-------|------------------|
| `bookings` | Extended with 4 new columns; existing RLS covers them |
| `sessions` | Reused for materialized sessions; no changes |
| `payments` | Extended with `booking_id`; existing RLS covers it |
| `profiles` | Teacher `specialties` field for specialist matching |
| `platform_settings` | All single-session prices; assessment limit |
| `teacher_availability` | Queried for specialist availability during assessment matching |
| `billing_events` | Spec 018 idempotency ledger; reused for webhook dedup |

---

## 6. Entity Relationship

```
payments ──── booking_id (FK UNIQUE) ──── bookings
                                              │ booking_product_type
                                              │ specialty (assessment)
                                              │ purpose (specialized)
                                              │ target_scope jsonb
                                              │
                                              ├── student_id FK profiles
                                              ├── teacher_id FK profiles (specialist)
                                              └── session_id FK sessions
```

---

## 7. Constitution Compliance

| Principle | Status |
|-----------|--------|
| RLS on every new column/table | ✅ Existing bookings/payments RLS covers new columns; no new unprotected table |
| service-role-only financial writes | ✅ Prices in platform_settings (admin write); start_instant_session_booking service_role only |
| userId from auth session | ✅ student_id derived from auth.getUser() never from request |
| BEFORE UPDATE OF guards | ✅ New trigger on booking_product_type, specialty, purpose, target_scope |
| SECURITY DEFINER lockdown | ✅ start_instant_session_booking EXECUTE grant preserved |
| No student_packages debit | ✅ p_payment_id path sets student_package_id = NULL |
| Quran validation | ✅ target_scope validated against src/lib/quran/ayah-counts.ts at route boundary |

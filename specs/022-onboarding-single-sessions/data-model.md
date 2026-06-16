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
  -- Canonical service-role bypass: read the role from the request JWT claims.
  -- NULL/empty JWT = trusted direct-DB/migration write (no JWT context) → bypass.
  IF nullif(current_setting('request.jwt.claims', true), '') IS NULL
     OR (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
  THEN RETURN NEW; END IF;
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

### `create_single_session_booking` (new — atomic assessment/specialized creator)

Per the 2026-06-16 clarification, the `payment_intent.succeeded` webhook MUST NOT
`INSERT bookings + sessions` directly. Instead it calls a single atomic
SECURITY DEFINER creator that materializes the booking **and** its session in one
transaction and links the payment — mirroring `start_instant_session_booking`.

```sql
CREATE OR REPLACE FUNCTION create_single_session_booking(
  p_student_id          uuid,
  p_teacher_id          uuid,
  p_payment_id          uuid,
  p_booking_product_type text,           -- 'assessment' | 'specialized'
  p_specialty           text DEFAULT NULL,
  p_purpose             specialized_purpose DEFAULT NULL,
  p_target_scope        jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
  v_session_id uuid;
BEGIN
  -- booking + session created atomically; never debits student_packages
  INSERT INTO bookings (student_id, teacher_id, student_package_id,
                        booking_product_type, specialty, purpose, target_scope)
    VALUES (p_student_id, p_teacher_id, NULL,
            p_booking_product_type, p_specialty, p_purpose, p_target_scope)
    RETURNING id INTO v_booking_id;

  INSERT INTO sessions (booking_id, student_id, teacher_id)
    VALUES (v_booking_id, p_student_id, p_teacher_id)
    RETURNING id INTO v_session_id;

  UPDATE bookings SET session_id = v_session_id WHERE id = v_booking_id;
  UPDATE payments SET booking_id = v_booking_id WHERE id = p_payment_id;

  RETURN v_booking_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_single_session_booking(
  uuid, uuid, uuid, text, text, specialized_purpose, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_single_session_booking(
  uuid, uuid, uuid, text, text, specialized_purpose, jsonb)
  TO service_role;
```

**EXECUTE lockdown**: REVOKE from public/anon/authenticated; GRANT to service_role only (NFR-002).

**Recovery path** ("payment confirmed but session creation fails"): because the whole
booking+session creation runs inside this one function/transaction, a partial
booking-without-session can never persist. The `billing_events` idempotency lock
(`pi_{id}`) is committed by the webhook around this call, so a retried
`payment_intent.succeeded` re-invokes the creator at most once; if the first call
raised, the lock is not finalized and the retry completes the booking idempotently.
A charge that cannot be materialized after retries is left recorded in `payments`
with `booking_id` NULL for reconciliation/refund (per FR-013, 018 rails).

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
| SECURITY DEFINER lockdown | ✅ start_instant_session_booking + create_single_session_booking: EXECUTE granted to service_role only |
| No student_packages debit | ✅ p_payment_id path sets student_package_id = NULL |
| Quran validation | ✅ target_scope validated against src/lib/quran/ayah-counts.ts at route boundary |

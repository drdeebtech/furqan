# Quickstart: Onboarding Assessment + Per-Session Single Sessions (Spec 022)

---

## Scenario 1 — Assessment booking (non-zero price)

```bash
# Setup: set assessment price, seed a specialist teacher
UPDATE platform_settings SET value = '5.00' WHERE key = 'single_session_assessment_price_usd';
# Seed teacher with specialties ARRAY['hifz']

# 1. Student requests assessment
POST /api/stripe/checkout/single-session
{ "productType": "assessment", "specialty": "hifz" }
# → 200 { checkoutUrl: "https://checkout.stripe.com/..." }

# 2. Complete Stripe payment in test mode
# → Stripe fires payment_intent.succeeded

# 3. Webhook creates booking
GET /api/single-sessions/my-bookings
# → booking with booking_product_type='assessment', specialty='hifz'
# → teacher.specialties includes 'hifz'

# Verify: no student_packages debit
SELECT sessions_used FROM student_packages WHERE student_id = :student_id;
# → unchanged (no debit)

# Verify: payments.booking_id linked
SELECT booking_id FROM payments WHERE stripe_payment_intent = :pi_id;
# → booking.id
```

---

## Scenario 2 — Assessment free (zero price)

```bash
UPDATE platform_settings SET value = '0.00' WHERE key = 'single_session_assessment_price_usd';

POST /api/stripe/checkout/single-session
{ "productType": "assessment", "specialty": "tajweed" }
# → 200 { bookingId: "...", message: "booking_created_free" }
# → No Stripe checkout created, booking created directly
# → No payment charge
```

---

## Scenario 3 — Instant session as standalone payment

```bash
POST /api/stripe/checkout/single-session
{ "productType": "instant", "teacherId": "teacher-uuid" }
# → checkoutUrl

# After payment_intent.succeeded webhook:
SELECT student_package_id FROM bookings WHERE id = :booking_id;
# → NULL (not funded by package)

SELECT booking_id FROM payments WHERE id = :payment_id;
# → booking.id (linked)

SELECT sessions_remaining FROM student_packages WHERE student_id = :student_id;
# → unchanged (subscription credits untouched)
```

---

## Scenario 4 — Assessment limit enforcement

```bash
# Student already has 1 assessment for 'hifz'

POST /api/stripe/checkout/single-session
{ "productType": "assessment", "specialty": "hifz" }
# → 422 { success: false, error: "Assessment limit reached for this specialty" }
# → No Stripe session created, no charge

# But different specialty is allowed:
POST /api/stripe/checkout/single-session
{ "productType": "assessment", "specialty": "tajweed" }
# → 200 { checkoutUrl: "..." }
```

---

## Scenario 5 — Specialized session with invalid Quran range

```bash
POST /api/stripe/checkout/single-session
{
  "productType": "specialized",
  "purpose": "consolidate_surah",
  "targetScope": { "surah": 999 },
  "teacherId": "teacher-uuid"
}
# → 422 { success: false, error: "Invalid surah: 999. Valid range is 1–114." }
# → Validated against src/lib/quran/ayah-counts.ts before any Stripe call

# Valid request:
POST /api/stripe/checkout/single-session
{
  "productType": "specialized",
  "purpose": "consolidate_surah",
  "targetScope": { "surah": 36 },
  "teacherId": "teacher-uuid"
}
# → 200 { checkoutUrl: "..." }
```

# API Contracts: Onboarding Assessment + Per-Session Single Sessions (Spec 022)

---

## 1. `POST /api/stripe/checkout/single-session`

**Auth**: Required (`auth.getUser()`)
**Purpose**: Creates a Stripe Checkout session in payment mode for assessment, instant, or specialized session.

### Zod Input
```ts
const SingleSessionCheckoutSchema = z.object({
  productType: z.enum(['assessment', 'instant', 'specialized']),
  specialty: z.string().optional(),      // required when productType = 'assessment'
  purpose: z.enum(['review','consolidate_surah','memorize_mutoon','test_juz_mutashabihat']).optional(),
  targetScope: z.object({               // required when productType = 'specialized'
    surah: z.number().int().min(1).max(114).optional(),
    juz: z.number().int().min(1).max(30).optional(),
    mutoon: z.string().optional(),
    mutashabihat: z.string().optional(),
  }).optional(),
  teacherId: z.string().uuid().optional(), // for instant/specialized; omit for assessment (auto-matched)
})
```

### Logic
1. Validate input with zod
2. Derive `studentId` from `auth.getUser()` — never from input
3. If `productType = 'assessment'`: validate specialty provided; check assessment limit vs `hifz_assessment_limit_per_specialty` (fail **409** if reached); find matching specialist (fail **422** if none)
4. If `productType = 'specialized'`: validate `targetScope` against `src/lib/quran/ayah-counts.ts` for any Quran-structural field
5. Look up price from `platform_settings`; if zero → skip Stripe and call the atomic `create_single_session_booking(student_id, teacher_id, payment_id := NULL, booking_type, specialty, purpose, target_scope)` via the **service-role** client (same single creation path as the webhook; **no** bare route-layer `INSERT bookings + sessions`). `payment_id` is NULL because no charge occurred.
6. If non-zero → create Stripe Checkout session (`mode: 'payment'`) with metadata `{booking_type, student_id, purpose, target_scope, teacher_id}`
7. Return checkout URL (paid path) or `{ bookingId }` (zero-price path)

### Success Response
```ts
{ success: true, data: { checkoutUrl: string } }
// or if price = 0:
{ success: true, data: { bookingId: string, message: 'booking_created_free' } }
```

### Error Codes
| Code | Meaning |
|------|---------|
| 400 | Invalid input / zod validation failure |
| 401 | Not authenticated |
| 409 | Assessment limit reached for this specialty (FR-014) — per-specialty count ≥ `hifz_assessment_limit_per_specialty`; a conflicting prior assessment already exists |
| 422 | No specialist available / invalid Quran range / unsupported currency (non-USD rejected, spec §Currency / FR — USD-only this phase) |

**Code rationale**: the per-specialty assessment limit is a state conflict (a prior assessment exists) → **409 Conflict**, distinct from the 422 "cannot process this request" cases (no specialist, invalid Quran range, non-USD currency). Both classes are checked **before any Stripe Checkout creation** (fail-before-charge, R-004).

---

## 2. `GET /api/single-sessions/assessment-specialists`

**Auth**: Required
**Purpose**: Returns available teachers with the requested specialty.

### Zod Query
```ts
const AssessmentSpecialistsQuery = z.object({
  specialty: z.string().min(1),
})
```

### Success Response
```ts
{
  success: true,
  data: Array<{
    teacherId: string
    displayName: string
    specialties: string[]
    hasAvailability: boolean
  }>
}
```

---

## 3. `POST /api/stripe/webhook` (existing route — extend with new branch)

**Auth**: Stripe webhook signature verification via `safeCompareSecret` (spec 018 pattern)
**New branch**: `payment_intent.succeeded`

### Handler Logic
1. Verify signature (existing)
2. If `event.type === 'payment_intent.succeeded'`:
   - Extract metadata: `{booking_type, student_id, purpose, target_scope, teacher_id}`
   - Check `billing_events` for idempotency key `pi_${paymentIntent.id}` — if exists → `skipped`
   - Insert `billing_events` row (idempotent lock)
   - Based on `booking_type`:
     - `'instant'` → call `start_instant_session_booking(student_id, teacher_id, payment_id)` via service-role
     - `'assessment'` or `'specialized'` → call the atomic SECURITY DEFINER creator `create_single_session_booking(student_id, teacher_id, payment_id, booking_type, specialty, purpose, target_scope)` via service-role — this creates the `bookings` row **and** its `sessions` row **and** links `payments.booking_id` in **one transaction**. Do **NOT** `INSERT into bookings + sessions` directly in the handler.
   - All via service-role client; `student_id` from PI metadata (set server-side at checkout creation)

> **Single creation path**: `create_single_session_booking` is the *only* place assessment/specialized bookings + sessions are materialized. Both the paid webhook branch (here, `payment_id = pi_*`) and the zero-price checkout branch (§1 step 5, `payment_id = NULL`) call it via service-role. There is no bare route-layer or webhook-layer `INSERT bookings + sessions` anywhere.

### Recovery — "payment confirmed but session creation fails"
Because the creator is atomic, a partial booking-without-session can never persist. The `billing_events` idempotency lock (`pi_{id}`) wraps the call, so a retried `payment_intent.succeeded` re-invokes the creator at most once and completes the booking idempotently. If creation cannot succeed after retries, the `payments` row is left with `booking_id` NULL — recorded, reconcilable, and refundable per FR-013 / spec 018 rails; the charge never silently vanishes.

### Idempotency
Reuses spec 018's `billing_events (idempotency_key UNIQUE)` — duplicate PI event → no-op.

---

## 4. `GET /api/single-sessions/my-bookings`

**Auth**: Required (student reads own via RLS)
**Purpose**: Returns the caller's single-session bookings.

### Query Params
```ts
const MyBookingsQuery = z.object({
  productType: z.enum(['assessment','instant','specialized']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
})
```

### Success Response
```ts
{
  success: true,
  data: Array<{
    bookingId: string
    productType: 'assessment' | 'instant' | 'specialized'
    specialty?: string
    purpose?: string
    targetScope?: object
    teacherId: string
    scheduledAt: string | null   // NULL = booking created but slot not yet chosen (data-model §3: sessions created unscheduled)
    status: string
    paymentId?: string
  }>,
  pagination: { total: number, limit: number, offset: number }
}
```

---

## 5. `POST /api/admin/single-sessions/prices`

**Auth**: Required + admin role check via `private.is_admin()`
**Purpose**: Updates a single-session price setting.

### Zod Input
```ts
const UpdatePriceSchema = z.object({
  key: z.enum([
    'single_session_instant_price_usd',
    'single_session_assessment_price_usd',
    'single_session_review_price_usd',
    'single_session_consolidate_surah_price_usd',
    'single_session_memorize_mutoon_price_usd',
    'single_session_test_juz_price_usd',
  ]),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a non-negative decimal USD amount'),
})
```

### Success Response
```ts
{ success: true, data: { key: string, value: string } }
```

### Error Codes
| Code | Meaning |
|------|---------|
| 403 | Not admin |
| 400 | Invalid key or value format |

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
3. If `productType = 'assessment'`: validate specialty provided; check assessment limit vs `hifz_assessment_limit_per_specialty`; find matching specialist (fail 422 if none)
4. If `productType = 'specialized'`: validate `targetScope` against `src/lib/quran/ayah-counts.ts` for any Quran-structural field
5. Look up price from `platform_settings`; if zero → skip Stripe, create booking directly
6. If non-zero → create Stripe Checkout session (`mode: 'payment'`) with metadata `{booking_type, student_id, purpose, target_scope, teacher_id}`
7. Return checkout URL

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
| 422 | No specialist available / assessment limit reached / invalid Quran range |
| 401 | Not authenticated |

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
    scheduledAt: string
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

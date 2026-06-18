# Implementation Plan: Onboarding Assessment + Per-Session Single Sessions

**Branch**: `022-onboarding-single-sessions` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/022-onboarding-single-sessions/spec.md`

---

## Summary

Build the payment-mode Stripe Checkout infrastructure (Phase 0 — this spec owns it, not spec 018): a `POST /api/stripe/checkout/single-session` route that creates one-time payment sessions, a `payment_intent.succeeded` branch in the existing webhook, and a `payments.booking_id` one-to-one link migration. Add 4 new columns to `bookings` (product type, specialty, purpose, target_scope) and adapt `start_instant_session_booking` to accept a payment ID instead of a package ID. Assessment bookings match a specialist teacher by specialty before charging; specialized sessions validate Quran-structural targets against canonical structure. All products are fail-closed (no session before payment confirmed) and never debit `student_packages`.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router
**Primary Dependencies**: Supabase JS v2, Stripe Node SDK (spec 018 instance), Zod v3
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` after baseline
**Testing**: Vitest (unit), Playwright (E2E critical flows)
**Constraints**: service-role-only financial writes; `userId` from `auth.getUser()`; `(select auth.uid())` initplan; SECURITY DEFINER lockdown; Quran integrity — no range generated or hardcoded; prices from `platform_settings` only

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS on every new table | ✅ PASS | No new standalone table; bookings/payments RLS covers new columns |
| Service-role key server-only | ✅ PASS | |
| `userId` from auth session, never request input | ✅ PASS | `student_id` set server-side at checkout creation |
| Zod validation at every route handler | ✅ PASS | |
| BEFORE UPDATE OF guards on new columns | ✅ PASS | booking_product_type, specialty, purpose, target_scope; service-role bypass uses canonical `nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'` (NULL/empty JWT = trusted direct-DB/migration) — never `current_setting('role')` |
| SECURITY DEFINER lockdown | ✅ PASS | start_instant_session_booking + create_single_session_booking EXECUTE granted to service_role only |
| Never debit student_packages | ✅ PASS | p_payment_id path sets student_package_id = NULL |
| Fail-closed — no session before payment | ✅ PASS | Booking created only in payment_intent.succeeded handler, via the atomic `create_single_session_booking` creator (assessment/specialized) — never a bare INSERT |
| Quran integrity | ✅ PASS | target_scope validated against src/lib/quran/ayah-counts.ts |
| No hardcoded prices | ✅ PASS | All from platform_settings |
| `npm run db:types` + tsc + lint pass | ✅ GATE | Required before PR |
| Local Postgres verification | ✅ GATE | NFR-003: free assessment, duplicate PI, no-debit invariant |

---

## Project Structure

```text
src/
├── app/api/
│   ├── stripe/
│   │   ├── checkout/single-session/route.ts   ← POST create payment-mode checkout
│   │   └── webhook/route.ts                   ← extend: payment_intent.succeeded branch
│   ├── single-sessions/
│   │   ├── assessment-specialists/route.ts    ← GET available specialists by specialty
│   │   └── my-bookings/route.ts               ← GET student's single-session bookings
│   └── admin/single-sessions/
│       └── prices/route.ts                    ← POST update price settings (admin)
└── lib/
    ├── domains/single-sessions/
    │   ├── specialist-matching.ts             ← findSpecialist(specialty)
    │   ├── quran-validation.ts                ← validateTargetScope(targetScope)
    │   └── pricing.ts                         ← getSingleSessionPrice(productType, purpose)
    │   (no booking.ts: booking creation logic lives in the SECURITY DEFINER fn
    │    `create_single_session_booking` (DB) + the webhook/route callers — no TS module)
    └── settings.ts                            ← add 6 new ALLOWED_SETTING_KEYS

supabase/migrations/
├── 20260619000000_payments_booking_id.sql     ← ALTER payments ADD booking_id
└── 20260619000001_single_session_columns.sql  ← specialized_purpose enum, bookings columns,
                                                  BEFORE UPDATE guard trigger (request.jwt.claims
                                                  service-role idiom), create_single_session_booking
                                                  atomic creator, seed prices
```

---

## Key Implementation Decisions

1. **Fail-before-charge ordering**: For assessments, specialist matching happens before Stripe Checkout creation. A 422 (no specialist / limit reached / invalid range) prevents any charge from being initiated.

2. **payment_intent.succeeded webhook branch**: Added to existing `/api/stripe/webhook/route.ts` alongside spec 018's `invoice.paid` and subscription event handlers. Same webhook secret, same signature verification. Idempotency via spec 018's `billing_events` unique key `pi_{paymentIntentId}`. For assessment/specialized bookings the handler calls the atomic `create_single_session_booking` SECURITY DEFINER creator (booking + session + payment link in one transaction) rather than a bare `INSERT bookings + sessions` — so a partial booking-without-session can never persist. Recovery: a charge that cannot materialize after retries stays in `payments` with `booking_id` NULL for reconciliation/refund.

3. **payments.booking_id one-to-one**: UNIQUE nullable FK on `payments`. Subscription-funded payments (spec 018) leave it NULL. Single-session payments set it at booking creation in the webhook handler.

4. **start_instant_session_booking adaptation**: Optional `p_payment_id` param added. When provided: `student_package_id = NULL`, `payments.booking_id` updated. Original debit path unchanged (backward-compat during coexistence with legacy until spec 024 cutover).

5. **Assessment limit per specialty**: Checked application-side before Stripe call using `platform_settings.hifz_assessment_limit_per_specialty` (seeded by spec 019). Admin-adjustable without deploy.

6. **Quran validation**: `src/lib/domains/single-sessions/quran-validation.ts` wraps `src/lib/quran/ayah-counts.ts`. Validates surah (1–114), juz (1–30), ayah ranges. Called at route boundary — before any DB write or Stripe session creation.

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ⏳ Next |

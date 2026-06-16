# Research: Onboarding Assessment + Per-Session Single Sessions (Spec 022)

**Phase**: م٥ | **Generated**: 2026-06-16 | **Spec**: `specs/022-onboarding-single-sessions/spec.md`

---

## R-001 — Payment-mode Checkout Infrastructure (Phase 0)

**Decision**: New route `POST /api/stripe/checkout/single-session` creates a Stripe Checkout session in `payment` mode (not `subscription` mode). The `payment_intent.succeeded` webhook event is handled by adding a new branch to the existing `/api/stripe/webhook` route. PaymentIntent metadata includes `booking_type`, `student_id`, `purpose`, and `target_scope`. The session/booking is created **only after** payment is confirmed — fail-closed.

**Rationale**: Spec 018 owns subscription-mode Checkout and its webhooks. This spec extends the same webhook route with a new event-type branch — one Stripe webhook registration, one secret, multiple event handlers. Fail-closed ordering prevents charge-without-session and session-without-charge states.

**Alternatives considered**:
- Separate webhook endpoint for single sessions: rejected — doubles Stripe webhook registration complexity, second secret needed, no benefit.
- Create session optimistically then charge: rejected — leaves orphan sessions if payment fails.

---

## R-002 — `payments.booking_id` One-to-One Link

**Decision**: `ALTER TABLE payments ADD COLUMN booking_id uuid UNIQUE REFERENCES bookings(id)`. This creates a one-to-one, nullable link. Nullable so existing subscription-funded `payments` rows (spec 018) are unaffected. Migration: `20260619000000_payments_booking_id.sql`.

**Rationale**: FR-011 requires one-to-one traceability between a one-time payment and the booking it funded. UNIQUE constraint at DB layer is the strongest guarantee — no two payments can claim the same booking.

**Alternatives considered**:
- Separate `single_session_payments` table: over-engineering; reusing `payments` is the established pattern.
- `booking_id` on `bookings` (reverse link): weaker — allows a booking with no payment to exist silently.

---

## R-003 — Assessment Limit Enforcement

**Decision**: Enforced at booking creation using the platform setting `hifz_assessment_limit_per_specialty` (already seeded to `'1'` by spec 019). Check: `SELECT COUNT(*) FROM bookings WHERE student_id = (select auth.uid()) AND booking_product_type = 'assessment' AND specialty = :specialty`. If count ≥ limit → 422. Admin can raise or lower the limit via `platform_settings` with no code change.

**Rationale**: Prevents abuse of free/cheap assessment sessions. Configurable without deploy per NFR-001. Assessment is per-specialty so a student can assess hifz once and tajweed once independently.

**Alternatives considered**:
- DB-level trigger: harder to surface a user-facing 422 with a clear reason; application-layer check is cleaner and auditable.
- Lifetime limit (not per-specialty): too restrictive; a student may genuinely need both hifz and tajweed assessment.

---

## R-004 — Specialist Matching for Assessment (Fail-Before-Charge)

**Decision**: Before creating the Stripe Checkout session, query `profiles WHERE role = 'teacher' AND specialties @> ARRAY[:specialty]::text[]` joined to `teacher_availability` for an open slot. If none found → 422 before any Stripe call. Ordering: match teacher → create Stripe Checkout → on `payment_intent.succeeded` → create booking.

**Rationale**: Never charge a student and then fail to deliver. The fail-before-charge order is the only safe ordering for an assessment. A 422 with "no specialist available" is a better UX than a charge with no session.

**Scale check**: Teacher pool is small (<100 teachers); full scan of profiles with specialties is acceptable. Add `GIN` index on `profiles.specialties` if needed.

**Alternatives considered**:
- Optimistic charge then match: rejected — creates refund liability and trust damage.
- Cache specialist availability: acceptable optimization later; not required at launch scale.

---

## R-005 — `start_instant_session_booking` Adaptation

**Decision**: Adapt the existing `start_instant_session_booking(p_student_id uuid, p_teacher_id uuid, p_student_package_id uuid)` SECURITY DEFINER function to accept an additional optional param `p_payment_id uuid DEFAULT NULL`. When `p_payment_id IS NOT NULL`, the function sets `bookings.student_package_id = NULL` and links `payments.booking_id = booking.id` instead. When `p_payment_id IS NULL`, the original package-debit path is preserved (backward-compatible during coexistence period with legacy).

**Rationale**: Minimal change preserving atomicity and EXECUTE lockdown. The function already handles the critical session-materialization race; reusing it avoids reimplementing atomic booking. Backward-compat is required because spec 024 cutover hasn't happened yet.

**Alternatives considered**:
- New separate function `start_single_session_booking`: cleaner long-term, but duplicates complex logic; deferred to post-cutover cleanup.
- Application-layer booking creation: loses atomicity and the existing race-safe guarantee.

---

## R-006 — Specialized Purposes Enum + Quran Validation

**Decision**: `CREATE TYPE specialized_purpose AS ENUM ('review','consolidate_surah','memorize_mutoon','test_juz_mutashabihat')`. New columns on `bookings`: `purpose specialized_purpose` and `target_scope jsonb` (e.g. `{"surah": 36}`, `{"juz": 30}`, `{"mutoon": "Al-Jazariyyah"}`). Any Quran-structural target (surah number, juz, ayah range) is validated against `src/lib/quran/ayah-counts.ts` at the route/action boundary before any DB write or Stripe call.

**Rationale**: Fixed enum enforces valid purposes at DB layer. `jsonb` for target_scope is flexible enough for the 4 purpose types without a separate table per purpose. Quran validation at the boundary prevents invalid ranges from ever reaching the DB (per AGENTS.md §2 and the `student_progress_ayah_range_guard` lineage).

**Alternatives considered**:
- Separate `specialized_session_details` table: over-engineering for 4 purpose types with simple jsonb targets.
- Free-text purpose + target: no DB-level validation; rejects invalid purposes silently.

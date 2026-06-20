# Tasks: Onboarding Assessment + Per-Session Single Sessions (Spec 022)

**Input**: `specs/022-onboarding-single-sessions/` (spec.md, plan.md, data-model.md, research.md, contracts/api.md)
**Branch**: `022-onboarding-single-sessions` (cut after spec 021 merges)
**Prerequisites**: spec 018 (`payments`, `billing_events`, `/api/stripe/webhook`), spec 019 (`platform_settings` with `hifz_assessment_limit_per_specialty`), spec 020 (`teacher_availability`, `profiles.specialties`).

---

## Phase 1: Setup

- [x] T001 Add 6 new keys to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`: `single_session_instant_price_usd`, `single_session_assessment_price_usd`, `single_session_review_price_usd`, `single_session_consolidate_surah_price_usd`, `single_session_memorize_mutoon_price_usd`, `single_session_test_juz_price_usd`
- [x] T002 Verify `billing_events`, `payments`, `bookings`, `teacher_availability` tables exist locally (spec 018 dependency)

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass.

---

## Phase 2: Foundational — DB Migrations

**⚠️ CRITICAL**: All user story routes blocked until T005 (`npm run db:types`) completes.

- [x] T003 Create `supabase/migrations/20260619000000_payments_booking_id.sql`:
  - `ALTER TABLE payments ADD COLUMN booking_id uuid UNIQUE REFERENCES bookings(id)`

- [x] T004 Create `supabase/migrations/20260619000005_single_session_columns.sql`:
  - `CREATE TYPE specialized_purpose AS ENUM ('review','consolidate_surah','memorize_mutoon','test_juz_mutashabihat')`
  - `ALTER TABLE bookings ADD COLUMN booking_product_type text CHECK(...)`, `specialty text`, `purpose specialized_purpose`, `target_scope jsonb`
  - BEFORE UPDATE OF trigger `bookings_single_session_identity_guard` on new columns (service_role and admin exempt). Service-role bypass MUST use the canonical verified idiom `nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'` (NULL/empty JWT = trusted direct-DB/migration write → bypass). Do NOT use `current_setting('role')` — it reads the wrong GUC and the exemption never matches.
  - `INSERT INTO platform_settings` for 6 new price keys with `'0.00'` seed values `ON CONFLICT DO NOTHING`

- [x] T005 `supabase migration up` → `npm run db:types` → commit regenerated `src/types/database.ts`

- [x] T006 Local verification (NFR-003):
  - Attempt UPDATE on `bookings.booking_product_type` as non-admin → blocked by trigger
  - Verify `payments.booking_id` UNIQUE constraint (two payments cannot claim same booking)
  - Verify `booking_id` nullable (existing payments unaffected)

- [x] T007 Adapt `start_instant_session_booking` DB function: add optional `p_payment_id uuid DEFAULT NULL` param; when set → `student_package_id = NULL` + `UPDATE payments SET booking_id = new_booking_id`; EXECUTE lockdown unchanged; verify both code paths work locally

- [x] T007b Create atomic SECURITY DEFINER creator `create_single_session_booking(p_student_id, p_teacher_id, p_payment_id, p_booking_product_type, p_specialty, p_purpose, p_target_scope)` in `supabase/migrations/20260619000005_single_session_columns.sql` (see data-model.md §3): creates booking + session in **one transaction**, sets `student_package_id = NULL`, links `payments.booking_id`. EXECUTE lockdown: REVOKE from public/anon/authenticated; GRANT to service_role only. The assessment/specialized webhook branches (T013/T019) AND the zero-price assessment route path (T012, called with `p_payment_id := NULL`) MUST call this fn — never a bare `INSERT bookings + sessions`. This is the single creation path for assessment/specialized bookings. Verify locally: partial booking-without-session can never persist; retried call is idempotent.

**Checkpoint**: `npm run sb:advisors` clean; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Assessment Booking (P1) 🎯 MVP

**Goal**: Student books an assessment with a matching specialist, paid via one-time payment. Zero-price = free (no Stripe). Fail-before-charge.

**Independent Test**: Set assessment price to $5 → request assessment for 'hifz' → verify specialist matched, Stripe checkout created, no charge until PI confirmed, after PI succeeded → booking.booking_product_type='assessment', teacher.specialties ∋ 'hifz', no student_packages debit.

- [x] T008 [P] [US1] Create `src/lib/domains/single-sessions/specialist-matching.ts`:
  - `findAvailableSpecialist(specialty: string): Promise<{teacherId: string} | null>` — queries profiles WHERE specialties @> ARRAY[:specialty]::text[] JOIN teacher_availability; returns first available teacher or null

- [x] T009 [P] [US1] Create `src/lib/domains/single-sessions/pricing.ts`:
  - `getSingleSessionPrice(productType: string, purpose?: string): Promise<number>` — reads from `platform_settings`; never returns hardcoded value

- [x] T010 [P] [US1] Create `src/lib/domains/single-sessions/quran-validation.ts`:
  - `validateTargetScope(targetScope: object): {valid: boolean, error?: string}` — validates surah (1–114), juz (1–30) against `src/lib/quran/ayah-counts.ts`; never generates or corrects values

- [x] T011 [US1] Create `src/app/api/single-sessions/assessment-specialists/route.ts`:
  - GET, auth required, query `{specialty}` zod-validated
  - Calls `findAvailableSpecialist` + returns list of matching teachers

- [x] T012 [US1] Create `src/app/api/stripe/checkout/single-session/route.ts` (assessment path):
  - POST, auth, zod input schema
  - Derives `studentId` from `auth.getUser()` — never from body
  - Assessment flow: validate specialty → check assessment limit (**409** if reached, per-specialty vs `hifz_assessment_limit_per_specialty`) → reject non-USD currency (**422**) → `findAvailableSpecialist` (**422** if none) → `getSingleSessionPrice`. All checks run **before** any Stripe call (fail-before-charge).
  - If price = 0: call `create_single_session_booking(student_id, teacher_id, p_payment_id := NULL, 'assessment', specialty, NULL, NULL)` via the **service-role** client — the SAME atomic creator the webhook uses (T007b/T013). Do NOT bare-`INSERT bookings + sessions` at the route. Return `{bookingId}`.
  - If price > 0: create Stripe Checkout `mode: 'payment'` with metadata `{booking_type:'assessment', student_id, teacher_id, specialty}`; return `{checkoutUrl}`

- [x] T013 [US1] Extend `src/app/api/stripe/webhook/route.ts` with `payment_intent.succeeded` branch:
  - Extract metadata from PI; check `billing_events` idempotency key `pi_{id}`; insert billing_events lock
  - For `booking_type = 'assessment'`: call `create_single_session_booking(student_id, teacher_id, payment_id, 'assessment', specialty)` via service-role (atomic booking+session+payment link). Do NOT `INSERT bookings + sessions` directly. On creator failure after retries, leave the `payments` row with `booking_id` NULL for reconciliation/refund (recovery path per FR-013)

- [x] T014 [US1] Unit test `src/lib/domains/single-sessions/specialist-matching.test.ts` + `pricing.test.ts` + `quran-validation.test.ts`

**Checkpoint**: Assessment booking end-to-end works; `student_packages` balance unchanged; `payments.booking_id` linked.

---

## Phase 4: User Story 2 — Instant Session as Standalone Payment (P1)

**Goal**: Instant session charged as one-time payment; `student_package_id = NULL`; subscription credits unchanged.

**Independent Test**: Buy instant session → `booking.student_package_id IS NULL`, `payments.booking_id = booking.id`, subscription credits unchanged.

- [x] T015 [US2] Extend `src/app/api/stripe/checkout/single-session/route.ts` with instant path:
  - `productType = 'instant'`: require `teacherId`; look up instant price; create Stripe Checkout with metadata `{booking_type:'instant', student_id, teacher_id}`

- [x] T016 [US2] Extend `payment_intent.succeeded` webhook branch for `booking_type = 'instant'`:
  - Call `start_instant_session_booking(student_id, teacher_id, payment_id)` via service-role; UPDATE `payments SET booking_id`

- [x] T017 [US2] Unit test `src/app/api/stripe/checkout/single-session/route.test.ts`: verify instant path sets correct metadata, does not touch student_packages

**Checkpoint**: Instant session `booking.student_package_id IS NULL`; `payments.booking_id` linked; subscription credits unchanged.

---

## Phase 5: User Story 3 — Specialized Single Session (P2)

**Goal**: Specialized session with purpose + validated target scope, charged one-time.

**Independent Test**: Request `consolidate_surah` with surah 36 → payment + booking with purpose/target_scope. Request surah 999 → 422 before any Stripe call.

- [x] T018 [P] [US3] Extend `src/app/api/stripe/checkout/single-session/route.ts` with specialized path:
  - `productType = 'specialized'`: require `purpose` and `targetScope`; call `validateTargetScope` (422 on fail); look up price by purpose; create Stripe Checkout with metadata `{booking_type:'specialized', purpose, target_scope, student_id, teacher_id}`

- [x] T019 [US3] Extend `payment_intent.succeeded` webhook branch for `booking_type = 'specialized'`:
  - call `create_single_session_booking(student_id, teacher_id, payment_id, 'specialized', NULL, purpose, target_scope)` via service-role (atomic booking+session+payment link). Do NOT `INSERT bookings + sessions` directly. On creator failure after retries, leave the `payments` row with `booking_id` NULL for reconciliation/refund

- [x] T020 [US3] Unit test: invalid surah → 422 before Stripe call; valid specialized → booking created; `student_packages` untouched

- [x] T020a [US3] Create `src/app/api/single-sessions/my-bookings/route.ts` (contracts §4): GET, auth required, returns the caller's own single-session bookings (RLS-enforced, `userId` from session never input), zod-validated query params, paginated. Closes the orphaned `my-bookings` contract.

**Checkpoint**: Invalid Quran range rejected before charge; valid specialized booking created with purpose + target_scope. `GET /api/single-sessions/my-bookings` returns only the caller's bookings.

---

## Phase 6: User Story 4 — Admin Price Management (P2)

**Goal**: Admin updates any single-session price; next booking charges updated amount.

- [x] T021 [US4] Create `src/app/api/admin/single-sessions/prices/route.ts`:
  - POST, auth + `private.is_admin()` check
  - Zod input: `{key, value}` — key must be in the 6 allowed price setting keys; value regex `^\d+(\.\d{1,2})?$`
  - UPDATE `platform_settings` via service-role; `revalidateTag('platform-settings')`

- [x] T022 [US4] Unit test: non-admin → 403; invalid key → 400; valid update → price reflected in next `getSingleSessionPrice` call

**Checkpoint**: Admin changes price → next booking charges updated amount.

---

## Phase 7: Polish

- [x] ⛔ T022b **BLOCKER (before go-live, not before build):** define the refund/reconcile ownership for charged-but-unserved payments (`payments` row with `booking_id` NULL after atomic-creator failure) — owner, ledger entry, and SLA (FR-013). Do NOT flip Stripe to live until this requirement exists and a reconciliation/refund path is implemented or explicitly accepted.
- [x] T023 [P] `npx tsc --noEmit` — fix all type errors
- [x] T024 [P] `npm run lint` — fix all ESLint issues
- [x] T025 `npm run test:unit` — all existing + new tests pass
- [x] T026 `npm run sb:advisors` — zero new advisories
- [x] T027 No-debit invariant test: verify no code path in the 3 new product types calls `deduct_package_session` or modifies `student_packages` (grep + unit test)
- [x] T028 RTL audit: specialty selection, specialized-purpose labels render correctly in RTL
- [x] T029 Price hardcode scan: `grep -rn '[0-9]\+\.[0-9]\+' src/lib/domains/single-sessions/ src/app/api/stripe/checkout/` → zero price literals
- [x] T030 Commit all spec artifacts to `docs/pivot-specs-019-024`; push

---

## Dependencies

- **Phase 2** → **Phases 3–6** (db:types must regenerate first)
- **T007** (start_instant_session_booking adaptation) → **T016** (instant webhook branch)
- **T007b** (create_single_session_booking atomic creator) → **T012** (zero-price assessment route path, `p_payment_id := NULL`) + **T013** (assessment webhook branch) + **T019** (specialized webhook branch)
- **T010** (quran-validation) → **T018** (specialized path)
- **T008 + T009** can run parallel with **T010 + T011** (different files)
- **US3 + US4** are independent of each other after Phase 2

## MVP Scope (P1 only)

Phases 1 → 2 → 3 → 4 → 7 partial. Delivers assessment + instant session flows.

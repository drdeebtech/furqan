# Tasks: Product Catalog + Credit/Package Redesign (Spec 019)

**Input**: `specs/019-catalog-credit-redesign/` (spec.md, plan.md, data-model.md, research.md, contracts/api.md)
**Branch**: `019-catalog-credit-redesign` (cut from `018-subscription-billing-foundation` after merge)
**Prerequisites**: spec 018 merged — `subscriptions`, `subscription_plans`, `student_packages`, `billing_events`, `stripe_customers` must exist.

---

## Phase 1: Setup

- [ ] T001 Verify branch cut from `018-subscription-billing-foundation`; confirm spec-018 tables exist locally
- [ ] T002 Add 8 new keys to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`: `hifz_individual_hourly_rate_usd`, `hifz_group_4_price_usd`, `hifz_group_6_price_usd`, `hifz_group_8_price_usd`, `hifz_second_individual_discount_pct`, `hifz_sibling_group_discount_pct`, `hifz_assessment_price_usd`, `hifz_assessment_limit_per_specialty`

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass.

---

## Phase 2: Foundational — DB Migrations

**⚠️ CRITICAL**: All user story work blocked until T005 (`npm run db:types`) completes.

- [ ] T003 Create `supabase/migrations/20260617000000_catalog_credit_redesign.sql`:
  - ALTER `subscription_plans`: add `is_hifz_product boolean NOT NULL DEFAULT false`, `sessions_per_month integer`, `session_duration_min integer`
  - ALTER `subscriptions`: add `is_hifz boolean NOT NULL DEFAULT false`, `pending_tier_change_id uuid` (FK to `pending_tier_changes`, deferred)
  - ALTER `packages`: add `subscription_plan_id uuid FK`, `is_hifz_product boolean NOT NULL DEFAULT false`, `product_category text CHECK('hifz_group','hifz_individual','tajweed_mutoon','other')`; widen `package_type` CHECK to include ONE new value `tajweed_course`
  - ALTER `student_packages`: add `subscription_id uuid FK`, `billing_cycle_key text`; add `UNIQUE INDEX uix_student_packages_cycle_grant (subscription_id, billing_cycle_key) WHERE billing_cycle_key IS NOT NULL`
  - CREATE TABLE `guardian_children (guardian_id uuid, child_id uuid, PRIMARY KEY(guardian_id,child_id), CHECK(guardian_id<>child_id))` + index on `child_id`
  - CREATE TABLE `subscription_discount_records (id uuid PK, subscription_id uuid FK, discount_type text CHECK('second_individual','sibling_group'), discount_pct numeric(5,2), setting_key text, applied_at timestamptz)` + index on `subscription_id` + BEFORE UPDATE immutability trigger
  - CREATE TABLE `pending_tier_changes (id uuid PK, subscription_id uuid FK, student_id uuid FK, from_package_id uuid FK, to_package_id uuid FK, change_reason text CHECK(...), requested_at timestamptz, applies_at_period_end boolean DEFAULT true, status text DEFAULT 'pending' CHECK('pending','applied','cancelled'), applied_at timestamptz, created_at timestamptz)` + partial UNIQUE index WHERE `status='pending'`
  - CREATE UNIQUE INDEX `uix_subscriptions_one_active_hifz ON subscriptions(student_id) WHERE is_hifz=true AND status NOT IN ('canceled','incomplete_expired')`
  - RLS on all 3 new tables: `(select auth.uid())` initplan; student reads own; guardian reads own children's; service_role/admin write
  - BEFORE UPDATE guards on `subscriptions.is_hifz`, identity cols of `pending_tier_changes`
  - Seed 6 tiers into `subscription_plans` + `packages` (`hifz_group_4/6/8`, `hifz_individual_4h/6h/8h`, `is_hifz_product=true`, `sessions_per_month=4/6/8`, `session_duration_min=60`)
  - Seed `platform_settings`: `hifz_individual_hourly_rate_usd='10.00'`, group prices `12/15/20`, discounts `10`, assessment `0.00`/`1`

- [ ] T004 Create `supabase/migrations/20260617000001_catalog_grant_function.sql`:
  - `grant_hifz_cycle_credits(p_subscription_id uuid, p_plan_id uuid, p_billing_cycle_key text) RETURNS uuid` — inserts `student_packages` with `sessions_total = plan.sessions_per_month`, `billing_cycle_key` for idempotency
  - SECURITY DEFINER; REVOKE EXECUTE FROM public/anon/authenticated; GRANT TO service_role

- [ ] T005 `supabase migration up` → `npm run db:types` → commit regenerated `src/types/database.ts`

- [ ] T006 Local verification (NFR-004): concurrent double-hifz insert blocked by unique index; `grant_hifz_cycle_credits` idempotent on same `billing_cycle_key`; `subscription_discount_records` UPDATE blocked

**Checkpoint**: `npm run sb:advisors` clean for new tables; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Catalog Browse (P1) 🎯 MVP

**Goal**: Student views 6 active tiers — type, sessions/month, duration, price all from data, zero hardcoded.

**Independent Test**: `GET /api/catalog/hifz` → 6 tiers; edit price in `platform_settings` → reflected immediately.

- [ ] T007 [P] [US1] Create `src/lib/domains/catalog/tiers.ts`: `getActiveCatalogTiers()` — queries `packages` JOIN `subscription_plans` WHERE `is_hifz_product=true`; returns typed `CatalogTier[]`
- [ ] T008 [P] [US1] Create `src/app/api/catalog/hifz/route.ts`: GET, public, zod-validated, `unstable_cache` tag `'hifz-catalog'` TTL 3600s
- [ ] T009 [US1] Unit test `src/lib/domains/catalog/tiers.test.ts`: mock supabase; verify filters, mapping, archived tiers excluded

**Checkpoint**: 6 tiers returned; `grep -r 'price.*[0-9]\+\.[0-9]' src/lib/domains/catalog/` → zero matches.

---

## Phase 4: User Story 2 — Single Active Hifz Guard (P1)

**Goal**: Second hifz subscription blocked at app + DB layer; tajweed runs concurrently.

**Independent Test**: Active hifz → attempt second hifz → 409 with clear message; tajweed attempt → 200.

- [ ] T010 [US2] Create `src/lib/actions/subscriptions/create-hifz-subscription.ts`: check active hifz before Stripe call; set `is_hifz=true` from `subscription_plans.is_hifz_product`; unique index is DB-layer backstop
- [ ] T011 [US2] Map `HifzAlreadyActiveError` → HTTP 409 with user-facing message in calling route
- [ ] T012 [US2] Unit test `src/lib/actions/subscriptions/create-hifz-subscription.test.ts`

**Checkpoint**: DB unique index blocks concurrent duplicates; app layer surfaces clear error.

---

## Phase 5: User Story 3 — Monthly Credit Grant (P1)

**Goal**: Paid cycle grants `sessions_per_month` into `student_packages` additively; idempotent on replay.

**Independent Test**: Simulate `invoice.paid` for 8-session plan → one `student_packages` row `sessions_total=8`; replay → no second row; prior row untouched.

- [ ] T013 [US3] Create `src/lib/domains/catalog/credit-grant.ts`: `grantHifzCycleCredits(subscriptionId, planId, billingCycleKey)` — calls DB fn via service-role; handles unique-constraint idempotency
- [ ] T014 [US3] Wire into `src/app/api/stripe/webhook/route.ts` `invoice.paid` branch: if `is_hifz_product=true`, call `grantHifzCycleCredits(subscription_id, plan_id, invoice.id)`
- [ ] T014a [US3] Apply pending tier changes at renewal (FR-019): in the `src/app/api/stripe/webhook/route.ts` `invoice.paid` branch, after the cycle grant, look up the subscription's pending `pending_tier_changes` row (the partial UNIQUE index guarantees at most one), transition it `pending → applied` (set `applied_at = now()`), switch the subscription to the new tier (`to_package_id` / new plan), and re-grant credits at the NEW tier's `sessions_per_month` for the new cycle. Service-role only; idempotent per `billing_cycle_key`.
- [ ] T015 [US3] Unit test `src/lib/domains/catalog/credit-grant.test.ts`: idempotency, correct `sessions_total`, prior rows untouched; plus pending-change application at renewal (T014a) — pending row transitions to `applied` with `applied_at` set and re-grant uses the new tier's count

**Checkpoint**: Two simulated cycles → two `student_packages` rows; first row `sessions_remaining` unchanged if unused.

---

## Phase 6: User Story 4 — Guardian + Family Discounts (P2)

**Goal**: Guardian links children; second individual + sibling group subscriptions receive configured discounts; discount recorded immutably.

**Independent Test**: Guardian + 2 children → child B individual hifz → discount applied + `subscription_discount_records` row. Admin changes setting → affects only new subscriptions.

- [ ] T016 [P] [US4] Create `src/lib/domains/catalog/discounts.ts`: `resolveGuardianDiscount(guardianId, productCategory)` reads `platform_settings` + `guardian_children` + active `subscriptions`; `recordDiscount(...)` inserts `subscription_discount_records`
- [ ] T017 [P] [US4] Create `src/app/api/guardian/children/route.ts`: GET, auth required, lists `guardian_children` for caller
- [ ] T018 [US4] Create `src/app/api/guardian/add-child/route.ts`: POST, zod `{childEmail}`, inserts `guardian_children` via service-role
- [ ] T019 [US4] Wire `resolveGuardianDiscount` + `recordDiscount` into `src/lib/actions/subscriptions/create-hifz-subscription.ts` checkout path
- [ ] T020 [US4] Unit test `src/lib/domains/catalog/discounts.test.ts`

**Checkpoint**: Child B subscription has `subscription_discount_records` row; setting change affects only future subscriptions.

---

## Phase 7: User Story 5 — Mid-Month Tier Upgrade (P2)

**Goal**: Same-type/same-teacher increase immediate + prorated; type/teacher/downgrade deferred to renewal.

**Independent Test**: Individual 4h → upgrade individual 6h same teacher → Stripe proration + delta 2-session grant. Type-change request → `scheduled_for_renewal`, no immediate change.

- [ ] T021 [P] [US5] Create `src/lib/domains/catalog/tier-changes.ts`: `canUpgradeImmediately(current, newPlan)` checks same `product_category` + `teacher_id` + sessions increasing; `scheduleRenewalChange(...)` inserts `pending_tier_changes`
- [ ] T022 [US5] Create `src/app/api/subscriptions/upgrade-tier/route.ts`: POST, auth, zod; if allowed → `stripe.subscriptions.update` with `proration_behavior:'always_invoice'` + `grantHifzCycleCredits` with delta sessions + `'upgrade_'+invoice.id` key; if not → `scheduleRenewalChange`
- [ ] T023 [US5] Create `src/app/api/subscriptions/schedule-tier-change/route.ts`: POST, auth, zod `{subscriptionId, toPackageId, changeReason}`; inserts `pending_tier_changes`
- [ ] T024 [US5] Unit test `src/lib/domains/catalog/tier-changes.test.ts`

**Checkpoint**: Immediate upgrade → new `student_packages` delta row + Stripe proration. Type/teacher/downgrade → `pending_tier_changes` row only.

---

## Phase 8: Polish

- [ ] T025 [P] `npx tsc --noEmit` — fix all type errors
- [ ] T026 [P] `npm run lint` — fix all lint issues
- [ ] T027 `npm run test:unit` — all ~510 existing + new tests pass
- [ ] T028 `npm run sb:advisors` — zero new advisories
- [ ] T029 Hardcoded-price scan: `grep -rn '[0-9]\+\.[0-9]\+' src/lib/domains/catalog/ src/app/api/catalog/ src/app/api/subscriptions/ src/app/api/guardian/` → zero price literals
- [ ] T030 Commit all spec artifacts + tasks.md to `docs/pivot-specs-019-024`; push

---

## Dependencies

- **Phase 2** → **Phases 3–7** (types must be regenerated first)
- **US1/US2/US3** parallel after Phase 2
- **US4/US5** parallel after Phase 2; US5 needs T013 (`grantHifzCycleCredits`) from US3
- **T014a** (renewal application of pending changes, FR-019) needs T013/T014 (grant + webhook branch) and the `pending_tier_changes` table (T003); it consumes the pending rows written by US5 (T021/T023), so verify against US5 once both land
- **Phase 8** → all stories complete

## MVP Scope (P1 only)

Phases 1 → 2 → 3 → 4 → 5 → 8 partial. Unblocks spec 020 scheduling.

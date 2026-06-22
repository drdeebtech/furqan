# Domains Codemap

**Last Updated:** 2026-06-22
**Location:** `src/lib/domains/**` (15 domains, 47 files)

The domains layer owns business logic. Each domain has a **single owner** (Table 3, CONTEXT.md). Phase 5 pilot: Booking domain migrated to `domains/booking/{actions.ts, types.ts, orchestrate.ts, validation.ts}`; others still split between `src/lib/actions/*` and route-colocated files.

---

## Domain Directory

| Domain | Responsibility | Key Files | Phase 5 Status |
|--------|---|---|---|
| **Billing** | Subscription lifecycle, Stripe mirroring, monthly cycle grants | `billing/{index, types, plans, subscriptions, events, orchestrate, webhook-handlers}.ts` | Waiting (Phase 6+) |
| **Booking** | Create, confirm, cancel, update bookings; teacher availability | `booking/{index, actions, orchestrate, types, validation}.ts` | ✓ Migrated |
| **Session** | End session, mark no-show, submit post-session notes | `session/{orchestrate, types}.ts` | Waiting |
| **Follow-up** | Create/grade homework; mark student ready | `follow-up/{actions, manage, bulk, shared, types}.ts` | Waiting |
| **Progress** | Record student progress (surah:ayah ranges, evaluations, errors) | `progress/{capture, types, validation}.ts` | Waiting |
| **Package** | Session-credit ledger; active package selection; debit/refund kernels | `package/ledger.ts` | Waiting |
| **Attendance** | Excuses, finalization, payroll records | `attendance/{excuses, finalize, payroll}.ts` | N/A (admin domain) |
| **Catalog** | Plan tiers, discount codes, tier-change scheduling, credit grants | `catalog/{tiers, discounts, tier-changes, credit-grant}.ts` | N/A |
| **Certificates** | Ijazah issuance, product catalog, Quran range validation | `certificates/{issue, next-product, quran-ranges}.ts` | N/A |
| **Murajaah** | Spaced-repetition (SM-2), batch schedules | `murajaah/{sm2, batch}.ts` | N/A |
| **Notifications** | In-app notification dispatcher routing | `notifications/routing.ts` | N/A |
| **Reports** | Monthly reports, session notes, month-close detection | `reports/{monthly-report, notes, month-close-detector}.ts` | N/A |
| **Scheduling** | Halaqas, cohort assignments, teacher scheduling | `scheduling/{assignments, availability, bookings, cohorts}.ts` | N/A |
| **Single-Sessions** | Instant booking pricing, specialist matching, Quran validation | `single-sessions/{pricing, specialist-matching, quran-validation}.ts` | N/A |
| **Honor Board** | Compute & cache rankings, opt-out management | `honor-board/{compute, opt-out}.ts` | N/A |

---

## Billing Domain

**Exports from `billing/index.ts`:**
- Types: `SubscriptionPlan`, `SubscriptionStatus`, `SubscriptionMirror`, `BillingEventStatus`, `GrantCycleInput`, `GrantCycleResult`
- Functions: `getActivePlanByCode`, `getPlanById`, `upsertMirror`, `shouldApplyEvent`, `toSubscriptionStatus`, `grantCycle`, `buildCycleKey`, `markEvent`, `handleInvoicePaid`, `handlePaymentFailed`, `handleSubscriptionLifecycle`, `handleSubscriptionDeleted`, `handlePaymentIntentSucceeded`

**Key files:**
- `types.ts` — type definitions for plans, subscriptions, events, cycle grants
- `plans.ts` — plan catalog mirror (from Stripe), read-path for plan lookups
- `subscriptions.ts` — Stripe subscription snapshot parsing, status detection, upsert logic
- `events.ts` — billing event taxonomy (`BillingEvents`, `FurqanEvent` union)
- `orchestrate.ts` — `grantCycle(paymentId)`: atomic payment verification + monthly credit grant (service-role only)
- `webhook-handlers.ts` — Stripe event handlers (`invoice.paid`, `customer.subscription.updated`, etc.)

**Entry points:**
- `src/app/api/stripe/webhook/route.ts` — verifies raw body, dispatches to `webhook-handlers`
- `src/lib/actions/subscriptions/create-hifz-subscription.ts` — student checkout (calls Stripe SDK, then domain)
- Cron: `src/app/api/cron/` — triggers `grantCycle` for monthly billing runs

**Key detail:** Billing emits events (`subscription.activated`, `subscription.renewed`, etc.) but does NOT own the debit kernel (Package owns `deduct_package_session()`). Service-role key required for all writes; anon reads plan catalog.

---

## Booking Domain ✓ MIGRATED

**Location:** `src/lib/domains/booking/`

**Exports from `index.ts`:**
- Types: `Booking`, `BookingStatus`, `AvailabilitySlot`
- Functions: `createBooking`, `confirmBooking`, `cancelBooking`, `updateBookingStatus`
- Errors: `BookingAlreadyConfirmedError`, `BookingNotFoundError`, `BookingNoPackageError`, `BookingConfirmError`, `BookingRoomCreationError`

**Key files:**
- `types.ts` — booking data shapes, enums, error classes
- `actions.ts` — `createBooking`, `updateBookingStatus`, `cancelBooking` (domain-owned mutations)
- `orchestrate.ts` — `confirmBooking(bookingId, roomUrl?)`: atomic session creation + package debit + events/notifications (called by the route adapter in `src/app/admin/bookings/actions.ts`)
- `validation.ts` — input shape validation, Zod schemas for bookings

**Route adapters still colocated:**
- `src/app/admin/bookings/actions.ts` — wraps `confirmBooking` and `createBooking`, handles FormData/auth
- `src/app/student/bookings/new/actions.ts` — wraps `createBooking` (student-initiated booking)

**Key detail:** Booking mutations route through domain `actions.ts` (phase 5 pilot). Orchestrator `confirmBooking` owns the 5-step sequence: pre-read booking row → reject if not `pending` → Daily room creation → atomic `confirm_booking_with_session()` SQL (UPDATE status + INSERT session; package debit runs via the `deduct_student_package` trigger inside this transaction) → best-effort post-commit fan-out (notify student + emit `booking.confirmed`).

---

## Session Domain

**Location:** `src/lib/domains/session/`

**Files:**
- `orchestrate.ts` — session lifecycle: end, mark no-show, recalc evaluations
- `types.ts` — session data shapes

**Entry points:**
- Teacher actions: `src/lib/actions/teacher-session.ts` — `endSession`, `markNoShow`, `savePostSessionNotes`
- Route adapter: `src/app/teacher/sessions/end/actions.ts`

**Cross-domain dependencies:**
- Calls `Progress` domain to create evaluations (`createTeacherEvaluation`)
- Calls `Reports` domain to detect month-close
- Calls `Attendance` domain for payroll finalization (teacher-initiated)

---

## Follow-up Domain

**Location:** `src/lib/domains/follow-up/`

**Files:**
- `actions.ts` — `createHomework`, `updateHomework`, `deleteHomework`
- `manage.ts` — bulk update (completion, status, grades)
- `bulk.ts` — batch operations (assign to cohort, mark ready)
- `shared.ts` — helper queries (shared schemas, shared types)
- `types.ts` — homework shapes, submission status enums

**Entry points:**
- Teacher actions: `src/lib/actions/follow-up.ts` — re-exported wrapping domain
- Route adapters: `src/app/teacher/follow-up/*/actions.ts`

**Key detail:** User-facing language is "follow-up" (متابعة); DB column names use "homework" (واجب) for historical reasons — never drift synonyms.

---

## Progress Domain

**Location:** `src/lib/domains/progress/`

**Files:**
- `capture.ts` — `recordProgress`: create/merge `student_progress` rows (never overwrite)
- `validation.ts` — validate surah:ayah ranges against canonical `ayah-counts.ts`, enforce `student_progress_ayah_range_guard` migration
- `types.ts` — progress event shapes, recitation error types

**Entry points:**
- Route adapters: `src/app/student/recite/actions.ts`
- Cron: `src/app/api/cron/murajaah-compute/route.ts` — triggers SM-2 batches via `Murajaah.batch()`

**Key detail:** Progress is **merged, never overwritten**. Tests must cover scheduler merge logic. Quran text comes only from canonical `src/lib/quran/`, never a model.

---

## Package Domain

**Location:** `src/lib/domains/package/`

**Files:**
- `ledger.ts` — `selectActivePackage`, `debitPackage`, `selectActivePackageWithFallback`

**Kernels (Postgres functions, called by ledger facade):**
- `deduct_package_session(uuid)` — DEBIT one credit (migration 20260601164428)
- `refund_package_session(uuid)` — CREDIT one credit
- Trigger: `deduct_student_package()` — on booking confirm, selects soonest-expiry package + calls debit kernel

**Entry points:**
- Booking domain: calls `debitPackage()` on confirm
- Route adapters: explicit group/class/instant session paths call facade

**Key detail:** Every confirmed 1:1 booking is stamped with `bookings.student_package_id` (audit H17/#346); a null stamp means no package was charged (#363). Credit is single-source via trigger; not exposed in facade.

---

## Attendance Domain

**Location:** `src/lib/domains/attendance/`

**Files:**
- `excuses.ts` — create, approve, reject student excuses
- `finalize.ts` — month-close: finalize attendance, compute absence deductions
- `payroll.ts` — calculate teacher payroll from sessions + attendance

**Entry points:**
- Admin actions: `src/lib/actions/account.ts` (excuse approval)
- Route adapters: `src/app/admin/bookings/excuses/actions.ts`
- Cron: `src/app/api/cron/auto-complete-sessions/route.ts` — auto-finalize absences at month-close

---

## Catalog Domain

**Location:** `src/lib/domains/catalog/`

**Files:**
- `tiers.ts` — tier definitions, tier lookup, tier validation
- `discounts.ts` — discount code validation, application
- `tier-changes.ts` — schedule tier upgrade/downgrade (Stripe `subscription_schedule`)
- `credit-grant.ts` — grant promotional credits to a student package

**Entry points:**
- Admin actions: `src/lib/actions/catalog.ts` (coupon creation, tier management)
- Route adapters: `src/app/admin/settings/tiers/actions.ts`

---

## Certificates Domain

**Location:** `src/lib/domains/certificates/`

**Files:**
- `issue.ts` — create Ijazah (completion certificate)
- `next-product.ts` — suggest next product after Ijazah
- `quran-ranges.ts` — validate Quran ranges for issuance

**Entry points:**
- Admin action: `src/lib/actions/certificates.ts`

**Key detail:** Ijazah text is never generated; Quran ranges must validate against canonical `src/lib/quran/ayah-counts.ts`.

---

## Murajaah Domain

**Location:** `src/lib/domains/murajaah/`

**Files:**
- `sm2.ts` — SM-2 (Spaced Repetition algorithm): interval calculation, ease-factor updates
- `batch.ts` — batch schedule: due-dates, update operations

**Entry points:**
- Cron: `src/app/api/cron/murajaah-due/route.ts` — fetch upcoming due surahs
- Cron: `src/app/api/cron/murajaah-compute/route.ts` — trigger batch recalc via n8n

**Key detail:** SM-2 logic is tested thoroughly; changes require local verification (see memory: `feedback_verify_money_triggers_locally.md`).

---

## Notifications Domain

**Location:** `src/lib/domains/notifications/`

**Files:**
- `routing.ts` — `notify(opts)`: in-app dispatcher (determines channel: Pusher, email, in-app message)

**Entry points:**
- Called from domain orchestrators (`confirmBooking`, `endSession`, etc.)
- Fire-and-forget: never throws to caller

---

## Reports Domain

**Location:** `src/lib/domains/reports/`

**Files:**
- `monthly-report.ts` — generate monthly parent/student/teacher report
- `notes.ts` — fetch/update session notes
- `month-close-detector.ts` — detect month-close, trigger finalization

**Entry points:**
- Teacher actions: `src/lib/actions/session-lesson-plan.ts`
- Route adapters: `src/app/teacher/sessions/notes/actions.ts`
- Cron: `src/app/api/cron/reconciliation/route.ts` — triggers month-close

---

## Scheduling Domain

**Location:** `src/lib/domains/scheduling/`

**Files:**
- `assignments.ts` — assign teacher to student (halaqas, cohorts)
- `availability.ts` — teacher availability slots, exceptions
- `bookings.ts` — query available bookings for students
- `cohorts.ts` — cohort/halaqa definitions

**Entry points:**
- Admin actions: `src/lib/actions/class-offerings.ts`
- Route adapters: `src/app/admin/halaqas/assign/actions.ts`

---

## Single-Sessions Domain

**Location:** `src/lib/domains/single-sessions/`

**Files:**
- `pricing.ts` — dynamic pricing, session cost calculation
- `specialist-matching.ts` — match student to assessment specialists
- `quran-validation.ts` — validate Quran range for instant booking

**Entry points:**
- Admin API: `src/app/api/admin/single-sessions/prices/route.ts`
- Route adapters: `src/app/student/single-sessions/book/actions.ts`

---

## Honor Board Domain

**Location:** `src/lib/domains/honor-board/`

**Files:**
- `compute.ts` — compute and cache leaderboard rankings (based on progress)
- `opt-out.ts` — student opt-out (RLS hides their rank from public view)

**Entry points:**
- API: `src/app/api/honor-board/route.ts` (GET rankings; compute happens on read/cache)
- Route adapters: `src/app/student/settings/privacy/actions.ts` (opt-out)

---

## Cross-Domain Choreographies (Orchestrators)

| Orchestrator | Domain | File | Triggered By |
|---|---|---|---|
| `confirmBooking(bookingId, roomUrl?)` | Booking | `booking/orchestrate.ts` | Teacher confirms booking / Admin confirms booking |
| `grantCycle(paymentId)` | Billing | `billing/orchestrate.ts` | Stripe webhook (cron fallback) |
| Session end (`endSession`) | Session | `session/orchestrate.ts` | Teacher marks session as complete |

Each orchestrator owns its full choreography end-to-end (auth, validation, mutations, events, notifications). See CONTEXT.md §3 for details.

---

## Related Maps

- [actions-and-views.md](./actions-and-views.md) — route adapters, server actions, views layer
- [api-routes.md](./api-routes.md) — webhook & cron triggers that call domains
- [app-screens.md](./app-screens.md) — user-facing screens that call actions

## See Also

- `CONTEXT.md` — domain ownership, role definitions, event taxonomy
- `CLAUDE.md` § 6.1 — agent navigation tips, large files to avoid

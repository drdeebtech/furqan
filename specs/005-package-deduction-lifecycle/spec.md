# Feature Specification: Package Deduction Lifecycle (دورة حياة الباقة)

**Feature Branch**: `005-package-deduction-lifecycle`
**Created**: 2026-05-08
**Status**: Brownfield documentation (the lifecycle is already in production; this spec captures observed behaviour)
**Input**: Formalize the prose state machine from `LIFECYCLES.md` §4 into spec-kit format so the package domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`.

> **Brownfield framing.** The package domain has been in production since FURQAN's V11 build. This spec is *descriptive* — it captures what production currently does, not what it should do. Per Constitution Principle V (Tracer-Bullet Adoption), retrofitting an already-shipped feature into spec-kit format is permissible documentation work.

> **State-machine reality check.** `LIFECYCLES.md` §4 prose draws **5 states** (`purchased → active → exhausted | expired | cancelled`). The actual `student_packages.status` CHECK constraint has only **3 explicit values**: `active | expired | cancelled`. "Exhausted" is a *virtual* state — it's `active` with `sessions_used >= sessions_total`; the row's `status` column does not change. "Purchased" is similarly virtual — it's just the default `active` state at insert time. This spec uses the 3-state reality.

## State machine (source of truth: `student_packages.status` CHECK + counters)

```
                                  Stripe payment / admin assign
                                            │
                                            ▼
                  ┌─────────────────────────────────────────────────┐
                  │                  active                          │
                  │ (sessions_used < sessions_total AND              │
                  │  expires_at > now() — implicit predicate)        │
                  └────┬─────────────────────┬─────────────────┬─────┘
                       │                     │                 │
            sessions_used                 expires_at      Admin cancels
            reaches sessions_total        passes               │
            (virtual: exhausted —         (admin batch         │
            no status change!)            or query-time         │
                       │                  predicate)            │
                       ▼                     ▼                  ▼
              status STAYS 'active'  ┌──────────┐      ┌────────────┐
              but deduct_package_    │ expired  │      │ cancelled  │
              session() returns      │(terminal)│      │ (terminal) │
              false / no-row-updated └──────────┘      └────────────┘
```

**Authoritative enforcement**:
- `deduct_package_session(p_package_id uuid)` SQL function — atomic counter increment with predicate evaluated in same row lock. Returns `true` on successful deduction, `null`/no-row when predicate fails.
- `deduct_package_session_mode(uuid, text)` — companion added 2026-05-05 for session_modes (private/halaqa/lecture); falls back to legacy `session_count` when per-mode counts are zero.
- Status CHECK constraint at column level: `status IN ('active','expired','cancelled')`.

**Owner files**:
- `src/lib/supabase/migrations/v11_001_packages.sql` — original schema and `deduct_package_session()` function definition (line 88).
- `supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql:233` — security-definer hardening.
- `supabase/migrations/20260505211356_extend_packages_with_session_modes.sql:77` — `deduct_package_session_mode()` companion.
- `src/app/admin/packages/actions.ts` — admin CRUD: `savePackage` (line 14), `deletePackage` (line 89), `togglePackageActive` (line 120).
- `src/lib/actions/group-session.ts:136` and `src/lib/actions/class-offerings.ts:233` — call sites for `deduct_package_session()`.
- Booking domain (`src/app/teacher/dashboard/actions.ts` `endSession()`) — additional call site at terminal `completed`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Student acquires a package (Priority: P1)

A student purchases a package via PayPal (or admin assigns one) and a `student_packages` row is created in `active` state with the appropriate `sessions_total`, `expires_at`, and per-mode session counts.

**Why this priority**: P1 — the entire monetisation loop assumes paid packages. Without this path, booking creation rejects (FR-009 in spec 003).

**Independent Test**: Trigger PayPal sandbox webhook `PAYMENT.CAPTURE.COMPLETED` for a `single_session` package; verify `student_packages` row exists with `status='active'`, correct counts, expiry computed from package definition.

**Acceptance Scenarios**:

1. **Given** a successful PayPal capture event for student S and package P (type `pack_8`, `session_count=8`), **when** the webhook handler runs, **then** a `student_packages` row exists with `student_id=S`, `package_id=P.id`, `status='active'`, `sessions_total=8`, `sessions_used=0`, `expires_at = now() + P.duration_min interval`, plus per-mode counts populated by `extend_packages_with_session_modes` migration.
2. **Given** an admin manually assigns a package via `/admin/students/<id>/packages`, **when** the admin form submits, **then** the same row shape is created, with `created_via='admin_assign'` (column may not exist today — verify).
3. **Given** the payment fails (Stripe webhook `payment_failed` or PayPal CAPTURE.DENIED), **when** the handler runs, **then** **no** `student_packages` row is created. PB-03 routes recovery for this case.

### User Story 2 — Booking confirm/end deducts a session atomically (Priority: P1)

When a session reaches terminal `completed` state, `endSession()` calls `deduct_package_session(package_id)` which atomically increments `sessions_used` if and only if the package is still active and has remaining capacity.

**Why this priority**: P1 — wrong implementation = race conditions where two concurrent bookings deduct from the same one-session-remaining package.

**Independent Test**: Schedule two concurrent `endSession()` calls against bookings tied to the same package with `sessions_remaining=1`. Verify only one increment lands; the other returns `null`/false (no deduction).

**Acceptance Scenarios**:

1. **Given** a `student_packages` row with `sessions_used=4`, `sessions_total=8`, `status='active'`, `expires_at > now()`, **when** `deduct_package_session(p_package_id)` is called, **then** the function returns `true`, the row's `sessions_used` becomes 5, no other column changes.
2. **Given** two concurrent calls to `deduct_package_session()` against the same package with `sessions_remaining=1`, **when** both run, **then** exactly one returns `true` (and increments) and the other returns `null` (predicate now false). No double-deduction.
3. **Given** a package with `sessions_used = sessions_total` ("virtual exhausted"), **when** `deduct_package_session()` is called, **then** the function returns `null`/no row updated. The caller (booking domain) MUST check the return value and act accordingly. The package's `status` column STAYS `'active'`.
4. **Given** a package with `expires_at < now()`, **when** `deduct_package_session()` is called, **then** the function returns `null`. Status column may still be `'active'` (no automatic flip — see virtual-states discussion).

### User Story 3 — Per-mode deduction routes to the right counter (Priority: P1)

For session-modes work (private/halaqa/lecture), `deduct_package_session_mode(p_package_id, p_mode)` deducts from the per-mode counter (e.g., `mode_counts->>'halaqa'`). When the per-mode count is zero, it falls back to the legacy `session_count` counter (which serves as the implicit `private` budget).

**Why this priority**: P1 — without correct per-mode routing, halaqa enrolments could exhaust a student's private session budget.

**Independent Test**: Create a package with `mode_counts = '{"private":4,"halaqa":2,"lecture":0}'`. Enrol in a halaqa twice; verify `mode_counts['halaqa']` decremented to 0. Enrol in a third halaqa; verify the call returns false (or falls back to private if explicitly configured).

**Acceptance Scenarios**:

1. **Given** a package with `mode_counts->>'halaqa'` = 2, **when** `deduct_package_session_mode(p, 'halaqa')` is called, **then** the halaqa counter decrements to 1; legacy `session_count` is unchanged.
2. **Given** a package with `mode_counts->>'halaqa'` = 0 AND `session_count > 0`, **when** `deduct_package_session_mode(p, 'halaqa')` is called, **then** the function falls back to the legacy `session_count` per the migration comment ("falls back to session_count when [per-mode is zero]").
3. **Given** both per-mode and legacy counters are zero, **when** the function is called, **then** it returns false / no deduction. Caller routes to PB-03 or surfaces a "package exhausted" error.

### User Story 4 — Admin manages package definitions (Priority: P2)

An admin creates, edits, archives (toggle active), or deletes a package definition (the `packages` table — *not* `student_packages`).

**Why this priority**: P2 — admins manage the catalog; students only consume it. Without this path, the catalog is static.

**Independent Test**: Sign in as admin → `/admin/packages` → create new package → toggle inactive → delete. Verify state transitions in the `packages` table.

**Acceptance Scenarios**:

1. **Given** admin role, **when** `savePackage()` is called with valid form data, **then** a `packages` row exists or is updated with the form values; `is_active` defaults to `true`.
2. **Given** an existing `packages` row, **when** `togglePackageActive()` is called, **then** the `is_active` column flips. Existing `student_packages` rows referencing this package are unaffected (purchased packages remain valid even if the catalog entry is deactivated).
3. **Given** a `packages` row with no `student_packages` referencing it, **when** `deletePackage()` is called, **then** the row is deleted. With references, the FK behavior depends on `student_packages.package_id` ON DELETE clause (verify).

### User Story 5 — Admin cancels a student's package (Priority: P3)

An admin can cancel a `student_packages` row (e.g., refund granted, fraud detected). Cancellation transitions `status` to `cancelled`; remaining `sessions_total - sessions_used` are forfeited unless a separate refund row is created.

**Why this priority**: P3 — recovery action, infrequent.

**Independent Test**: As admin → cancel an active package → verify `status='cancelled'`, `cancelled_at` populated, deduction calls subsequently return false.

**Acceptance Scenarios**:

1. **Given** a `student_packages` row with `status='active'`, **when** admin cancels via `/admin/students/<id>/packages/<package_id>/cancel`, **then** `status='cancelled'`, `cancelled_at=now()`, optional `cancel_reason`. Subsequent `deduct_package_session()` calls return false.
2. **Given** a `cancelled` package, **when** any code path attempts re-activation, **then** the operation fails (no transition out of terminal `cancelled`). Today this is at the column-level CHECK constraint AND at TS-level guards (verify both).

### Edge Cases

> *AI-drafted pending operator review.* Operator delegated drafting in lifecycles 1 and 2; same pattern continues. Replace or extend with real production scars before merge or in a follow-up commit.

- **Virtual `exhausted` state confuses callers.** A package with `sessions_used == sessions_total` has `status='active'` (literal) but is functionally exhausted. Callers that read `status` directly (e.g., admin dashboards, retention reports) see "active" but the student can't book. The bookable check must combine `status='active'` AND `sessions_used < sessions_total` AND `expires_at > now()` — a single source of truth function would be cleaner.
- **`expires_at` reached but no automatic transition.** Time-based expiry is *implicit* — `deduct_package_session()` predicate fails when `expires_at < now()` but no cron flips `status` to `'expired'`. Reports counting `WHERE status='expired'` undercount real expiries. n8n expiry-countdown workflow (per LIFECYCLES.md §4 alerts) reads the predicate, not the status column.
- **Refund-back path on no-show.** When booking ends `no_show` with `no_show_party='teacher'`, the booking spec (003) FR-007 says NO deduction. But if `deduct_package_session()` was called accidentally (e.g., a buggy code path), there's no `refund_package_session()` companion function — the deduction is one-way only. Admin would need to manually decrement via SQL.
- **Per-mode fallback consistency.** `deduct_package_session_mode('halaqa')` falling back to legacy `session_count` (which is the implicit `private` budget per the migration comment) means a student's halaqa enrolment can silently consume their private budget. Operator may want to make this explicit ("halaqa budget exhausted; deduct from private?") rather than implicit.
- **Concurrent purchase + booking race.** Student has 0 sessions; submits payment + immediately books a session. PayPal webhook arrives 200ms after the booking creation attempt. FR-009 in spec 003 reads `student_packages` at booking creation time — depending on the order, the booking may reject even though payment succeeded.
- **Cancelled package with completed sessions.** Admin cancels a package that has 3 of 8 sessions used. The 3 sessions stay completed; the 5 remaining are forfeited. Refund accounting (5 × per-session price) lives in the payments domain, not packages — cancellation here doesn't auto-create a refund row.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist package state in `student_packages.status` using the CHECK constraint values `active | expired | cancelled`. Counter columns (`sessions_used`, `sessions_total`, `expires_at`, `mode_counts`) drive the *virtual* states (`exhausted`, `purchased`).
- **FR-002**: Session deduction MUST be atomic. The `deduct_package_session(p_package_id uuid)` plain-SQL function provides this — predicate evaluation and counter increment happen in the same row lock.
- **FR-003**: Per-mode deduction (`deduct_package_session_mode(p_package_id, p_mode)`) MUST decrement the appropriate per-mode counter; on zero, MUST fall back to the legacy `session_count` per the existing migration comment.
- **FR-004**: A package whose `sessions_used = sessions_total` MUST behave as exhausted (deduction returns false) without changing `status`. "Exhausted" is virtual.
- **FR-005**: A package whose `expires_at < now()` MUST behave as expired (deduction returns false) without changing `status`. Time-based expiry is virtual.
- **FR-006**: Admin can transition a package to `cancelled`. The transition is one-way (terminal). Forfeit accounting (refund, credit) lives in the payments domain, not in this lifecycle.
- **FR-007**: All package-mutating server actions MUST go through `loudAction` per Constitution Principle II. [DRIFT — see "Known divergences" below.]
- **FR-008**: SECURITY DEFINER on `deduct_package_session*()` functions MUST be retained per the 2026-04-28 RLS hardening migration. Removing it breaks the deduction path under non-admin RLS contexts.
- **FR-009**: Catalog management (`packages` table CRUD via `savePackage`, `deletePackage`, `togglePackageActive`) MUST be admin-only via `requireRole("admin")` at the route adapter.
- **FR-010**: Booking domain (spec 003) MUST consult `student_packages` at booking creation (FR-009 of spec 003) AND at terminal `completed` (call `deduct_package_session()` from `endSession()`). The package domain is read-only at create time and write at completed.

### Key Entities

- **Package** (`public.packages`): catalog row. `package_type` CHECK constraint (`single_session | pack_4 | pack_8 | pack_12 | full_course`). Holds pricing in 4 currencies (USD, GBP, SAR, AUD), session counts, duration, features (bilingual), display order.
- **StudentPackage** (`public.student_packages`): per-student subscription record. Holds `sessions_used`, `sessions_total`, `expires_at`, `status`, `mode_counts` (jsonb, added 2026-05-05), `cancelled_at`, `cancel_reason`.
- **Payment** (`public.payments`): per-PayPal-capture record. References both `student_packages.id` and the PayPal capture ID.
- **DeductionFunctions** (DB): `deduct_package_session(uuid)` and `deduct_package_session_mode(uuid, text)`. Plain SQL, SECURITY DEFINER. The atomic critical path of this domain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero double-deductions per month at 50k DAU (atomic-counter SQL function guarantees this).
- **SC-002**: 100% of `endSession()` calls that should deduct (i.e., booking transitions to `completed`) result in exactly one `deduct_package_session()` invocation. No silent skips.
- **SC-003**: Per-mode fallback behaviour matches the migration comment in 100% of test cases (zero `halaqa` budget + non-zero `session_count` → fallback succeeds).
- **SC-004**: At 50k DAU with ~250k bookings/month → ~250k deductions/month, the deduction function P95 latency stays under 50ms (single-row UPDATE with primary-key-equivalent predicate).
- **SC-005**: Admin package CRUD operations have zero impact on existing `student_packages` rows. Toggling a `packages` catalog row inactive does NOT affect students who already purchased it.

## When this lifecycle fails

- **PB-03 — Payment succeeded but package not fulfilled**: PayPal/Stripe webhook reports success but no `student_packages` row exists. Resolve via webhook replay, manual creation, or refund. The package domain is downstream — recovery actions write directly to `student_packages`.
- **PB-07 — Delivery failures spiking** (low-balance / expiry alerts): n8n workflows for low-balance (≤2 sessions) and expiry-countdown (7/3/1 days) read the *virtual* states via predicate queries. Alert delivery failures don't break the lifecycle but degrade renewal conversion.

## Known divergences from production (filed as follow-up issues at end of Phase 1)

- **D-001**: **Admin package server actions are unwrapped** — `savePackage`, `deletePackage`, `togglePackageActive` in `src/app/admin/packages/actions.ts` use ad-hoc `{ error }` returns. None use `loudAction`. Same Phase 2 audit batch as booking and follow-up D-001s.
- **D-002**: **No `refund_package_session()` companion function.** A wrongly-deducted session has no atomic undo. Edge case 3. Phase 2 candidate when refund tooling is built out.
- **D-003**: **Status `expired` is never written by application code.** Only the virtual predicate triggers expiry behaviour. Reports filtering `WHERE status='expired'` undercount real expiries. Operator may want a nightly cron to flip `status='expired'` for expired rows so reports work, OR a query-time view that combines status + predicate. Phase 2 decision.
- **D-004**: **Per-mode fallback is implicit and silent.** `deduct_package_session_mode('halaqa')` falling back to legacy `session_count` may surprise students whose private budget gets consumed by halaqa enrolments. Edge case 4. Operator decision: explicit prompt, or accept implicit fallback.
- **D-005**: **`student_packages.cancel_reason` field exists** (assumed; verify) but is freeform — same shape as booking `cancel_reason` (D-002 in spec 003). Same enum-normalisation candidate.

## Assumptions

- Authentication and authorization happen at the route adapter via `requireRole(...)` (Constitution Principle IV). Admin-only paths use `requireRole("admin")`. Domain functions (SQL) run under SECURITY DEFINER.
- The `student_packages.status` CHECK constraint is canonical (`active | expired | cancelled`) and not extended in this PR.
- The `package_type` CHECK constraint values are canonical (`single_session | pack_4 | pack_8 | pack_12 | full_course`) and not extended in this PR.
- Multi-currency pricing (USD, GBP, SAR, AUD) is per-package; conversion is done at PayPal capture time, not deduction time.
- This spec covers the V11 package domain plus the 2026-05-05 session-mode extension. Stripe checkout flow is documented as deferred in CLAUDE.md.
- Cross-spec: spec 003 (booking) reads/writes via `student_packages`; spec 004 (follow-up) and spec 001 (murajaah) do not touch this domain.

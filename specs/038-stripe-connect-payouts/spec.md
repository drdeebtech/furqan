# Feature Specification: Stripe Connect Teacher Payouts

**Feature Branch**: `feat/038-stripe-connect-payouts`
**Created**: 2026-07-15
**Status**: Draft
**Replaces**: manual monthly payroll flip (`teacher_payouts.status` pending → paid, done by hand today)

## Current State (as-built references — read before building)

- **Payout model today**: `src/lib/domains/attendance/payroll.ts` wraps the `run_monthly_payroll` SECURITY DEFINER RPC (`supabase/migrations/20260619000004_attendance_payroll_fns.sql`). It aggregates `session_deliveries` into one `teacher_payouts` row per teacher per month; money then moves **outside the platform** (manual bank transfer) and an admin flips `status` to `paid`.
- **Earning source of truth**: `session_deliveries` (`supabase/migrations/20260619000003_payroll_tables.sql`) — one immutable row per delivered session, rate snapshotted at delivery, inserted **only** by `finalize_attendance` (service-role). A session that was cancelled or no-show never gets a row. This is already the attendance-verified gate this spec builds on.
- **Webhook architecture**: `src/app/api/stripe/webhook/route.ts` is a thin verify-raw-body + dispatch shell; handlers live in `src/lib/domains/billing/webhook-handlers.ts` with the `EventContext` / `markEvent` pattern and the `billing_events (stripe_event_id UNIQUE)` idempotency ledger, plus secondary sentinels (`pi_{id}`) for object-level dedup.
- **Charge entry points**: `src/app/api/stripe/checkout/route.ts` (subscriptions), `src/app/api/stripe/checkout/single-session/route.ts`, `src/app/api/stripe/checkout/prepaid-hours/route.ts`.
- **Split math**: `src/lib/courses/revenue-split.ts` — `computeCourseRevenueSplit`, integer cents only, teacher share in basis points (`teacher_revenue_share_bps` pattern), teacher rounds DOWN, platform derived by subtraction so the split always sums exactly.
- **Composition with spec 036** (`specs/036-teacher-marketplace/spec.md`): 036 is discovery only (search/filter/rank on `/teachers`). 038 owns everything money-side for teachers. The only shared surface is the teacher profile; 038 adds **no** search-facing fields. A teacher's payout-readiness MUST NOT gate their marketplace visibility in this spec (036's publish gate is unchanged).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Teacher Onboards to Stripe Express (Priority: P1)

A teacher opens their dashboard, sees a "Set up payouts" card, clicks it, and is sent through Stripe's hosted Express onboarding (identity, bank account). On return, the dashboard shows their payout status: onboarding incomplete / pending verification / payouts enabled.

**Why this priority**: No Connect account → no automated transfer is possible. Everything else depends on this.

**Independent Test**: In Stripe test mode, a teacher account completes hosted onboarding with Stripe's test data; the dashboard card flips to "payouts enabled" after the `account.updated` webhook lands — without a page rebuild or admin action.

**Acceptance Scenarios**:

1. **Given** a teacher with no Connect account, **When** they click "Set up payouts", **Then** the server creates an Express account, stores the mapping, and redirects them to a fresh Stripe Account Link — the teacher never sees a Stripe secret or account id in the client.
2. **Given** a teacher who abandoned onboarding midway, **When** they click the card again, **Then** they get a **new** Account Link for the **same** account (links are single-use and expire; no duplicate account is created).
3. **Given** Stripe finishes verification, **When** `account.updated` arrives with `payouts_enabled=true`, **Then** the stored status flips and the teacher dashboard reflects it on next load.
4. **Given** a student or admin id is supplied in the request body, **Then** it is ignored — the Connect account is always created for the **session** user (🛠 `userId` from session, never from input).
5. **Given** the teacher's dashboard renders in Arabic RTL, **Then** the payout status card renders correctly RTL (🎓 lens — test, don't assume).

---

### User Story 2 — Automated Transfer After Confirmed Session (Priority: P1)

After a teacher delivers a session and attendance is finalized, the platform automatically creates a Stripe Transfer of the teacher's earnings to their Connect account — no admin spreadsheet, no manual bank run.

**Why this priority**: This is the program's core promise: replace manual payroll with money that moves itself, correctly, exactly once.

**Independent Test**: Local Supabase + Stripe test mode: finalize attendance for a seeded session (creating a `session_deliveries` row), run the transfer sweep, assert exactly one `teacher_transfers` row and one test-mode Transfer with the deterministic idempotency key; run the sweep again and assert zero new rows/transfers.

**Acceptance Scenarios**:

1. **Given** a `session_deliveries` row exists (attendance finalized = CONFIRMED) and the teacher has `payouts_enabled=true` and no active hold, **When** the transfer sweep runs after the hold window elapses, **Then** exactly one Transfer is created for `duration_minutes / 60 × hourly_rate_usd`, converted to integer cents (📖 lens: pay only for sessions actually taught).
2. **Given** a session was cancelled or marked no-show, **Then** no `session_deliveries` row exists and **no transfer is ever attempted** — eligibility is derived from the delivery ledger, not from bookings.
3. **Given** the sweep crashes after calling Stripe but before writing its DB row, **When** it re-runs, **Then** the Stripe idempotency key (`transfer:{session_delivery_id}`) returns the original Transfer and the DB `UNIQUE(session_delivery_id)` backstop prevents a duplicate row — mirroring the `billing_cycle_key` pattern in `src/lib/domains/billing/orchestrate.ts`.
4. **Given** a teacher has `hourly_rate_usd` missing or 0, **Then** no transfer is created and a structured exception surfaces to ops (same fail-closed posture as FR-030 in the existing payroll RPC — never a $0 payout, never a guessed rate).
5. **Given** the originating charge is identifiable (single-session or course purchase), **Then** the charge and its transfer share a `transfer_group` so the money is traceable end to end; **Given** the session was funded by pooled subscription credits, **Then** the transfer carries a `transfer_group` of the delivery id and is funded from platform balance (no `source_transaction`).
6. **Given** the platform's available Stripe balance cannot cover a transfer, **Then** the transfer attempt fails closed, the entry stays `pending` with the error recorded, and it is retried on the next sweep — earnings are never silently dropped or double-sent.

---

### User Story 3 — Refund Claws Back Teacher Earnings (Priority: P2)

A student is refunded for a charge whose session(s) already paid the teacher. The platform reverses the corresponding transfer(s) so the teacher does not keep earnings for refunded money.

**Why this priority**: Without clawback, every refund is a direct platform loss and an accounting hole; with wrong clawback, teachers are underpaid — both are money-integrity failures.

**Independent Test**: Stripe test mode: create charge → transfer → refund the charge via Stripe CLI; assert a Transfer Reversal is created for exactly the transferred amount tied to that charge's `transfer_group`, and a negative clawback row appears in the ledger summing the teacher's net to the correct value.

**Acceptance Scenarios**:

1. **Given** a full refund on a charge with one linked transfer, **When** `charge.refunded` arrives, **Then** a Transfer Reversal for the full transfer amount is created (idempotent on `reversal:{refund_id}:{transfer_id}`), and a negative `teacher_transfers` clawback entry records it.
2. **Given** a partial refund, **Then** the reversal is proportional to the refunded fraction of the teacher's share, computed in integer cents with the platform absorbing the sub-cent remainder (inverse of the rounding rule in `src/lib/courses/revenue-split.ts` — never claw back more than the teacher received).
3. **Given** the transfer's reversible balance is smaller than the clawback owed (teacher already paid out), **Then** the reversal is capped at the reversible amount and the shortfall is recorded as a **teacher balance debt** to be offset against future transfers. ⚠ **HUMAN REVIEW (fiqh/policy)**: whether and how debt may be deducted from future earnings, and whether the teacher must consent, is a compensation-fairness ruling — the spec records the mechanism, a human decides the policy before enablement.
4. **Given** a refund on a charge with no linked transfer (e.g. refunded before the hold window elapsed), **Then** the pending earning entry is voided instead — no reversal call is made.
5. **Given** the same `charge.refunded` event is redelivered, **Then** no second reversal or debt row is created (billing_events ledger + reversal unique key).

---

### User Story 4 — Dispute Pauses Payouts (Priority: P2)

A chargeback (`charge.dispute.created`) lands on a charge linked to teacher earnings. All not-yet-transferred earnings tied to that charge are held immediately; the hold releases (dispute won) or converts to clawback (dispute lost) when the dispute closes.

**Why this priority**: Disputed money may be pulled back by the card network; transferring it out during the dispute converts a maybe-loss into a certain one.

**Independent Test**: Stripe CLI fixture fires `charge.dispute.created` on a linked charge; assert affected pending entries flip to `held` and the sweep skips them; fire `charge.dispute.closed` (won) and assert they return to `pending`; (lost) and assert they are voided/clawed back.

**Acceptance Scenarios**:

1. **Given** a dispute is created on a linked charge, **Then** every pending earning entry funded by that charge moves to `held` before the next sweep runs, and an ops alert row is written.
2. **Given** the dispute closes as **won**, **Then** held entries return to `pending` and pay on the next sweep — the teacher is never permanently penalized for a dispute the platform won (📖 lens: the teacher taught; withholding earned pay without cause is an amanah violation).
3. **Given** the dispute closes as **lost**, **Then** held entries are voided and any already-transferred amount follows the User Story 3 clawback path.
4. **Given** a dispute on a charge with no teacher linkage (e.g. platform-owned course), **Then** the handler marks the event processed with no teacher-side effect (existing `handleChargeDisputed` prepaid behavior in `src/lib/domains/billing/webhook-handlers.ts` is untouched).

---

### User Story 5 — Admin Payout Operations Dashboard (Priority: P3)

An admin sees, per teacher: Connect status, pending/held/transferred earnings, failed transfers with error detail, debts, and dispute holds — and can pause/resume a teacher's payouts with a reason.

**Why this priority**: Automation without observability is how money silently leaks. Ops needs the same visibility the manual spreadsheet gave, plus controls.

**Independent Test**: Seed one teacher in each state (no account / onboarding / enabled / held / failed transfer / debt); the admin page renders all six correctly; a non-admin requesting the page or its data gets nothing (RLS-verified at the DB level, not just UI-hidden).

**Acceptance Scenarios**:

1. **Given** an admin, **When** they open the payouts dashboard, **Then** they see totals per state and per teacher, with each failed transfer showing the recorded Stripe error.
2. **Given** an admin sets a manual hold on a teacher, **Then** the sweep skips that teacher until the hold is lifted, and both actions are audit-logged (who, when, why).
3. **Given** a teacher, **When** they open their own earnings page, **Then** they see only their own entries and transfers (RLS: `teacher_id = auth.uid()` select, same shape as `sd_teacher_select` / `tp_teacher_select` in `20260619000003_payroll_tables.sql`).

---

### Edge Cases

- **Onboarding link expired / reused** → Account Links are minted fresh on every click; a stale link error page routes back to the dashboard card.
- **`account.updated` flips `payouts_enabled` back to false** (Stripe re-verification) → status mirror updates; sweep skips the teacher; teacher dashboard shows "action required" with a fresh onboarding link.
- **Teacher's Connect account is rejected/disabled by Stripe** → entries stay `pending` indefinitely; ops alert. If the human-approved policy (below) permits settling such an entry off-Stripe, an admin records it as terminal **`manual_paid`** (service-role write only, audit-logged: who, when, evidence reference) — a state the transfer sweep excludes at the DB level, so a manually settled entry can never later be transferred or paid twice. Until that policy is approved, entries simply stay `pending`.
- **Transfer succeeds at Stripe but our webhook confirming it is delayed/lost** → the DB row was written synchronously at creation; `transfer.*` webhooks only reconcile status, never create rows.
- **Refund arrives for a charge spanning multiple sessions/entries** → clawback distributes proportionally across that charge's entries, oldest first, integer cents, remainder to platform.
- **Duplicate webhook delivery (any event)** → `billing_events` UNIQUE + per-object unique keys make every handler a no-op on replay.
- **Teacher in a country Stripe Connect doesn't support** → onboarding fails at Stripe's hosted page; status stays `onboarding_incomplete`; entries accrue as `pending`; ops sees it. Post-cutover, the only safe settlement mechanism for these entries is the same terminal `manual_paid` state above (excluded from sweep eligibility, audit-logged) — never a re-widening of FR-021. ⚠ **HUMAN REVIEW (policy)**: **whether** these teachers are paid off-Stripe at all (and on what rail) is out of scope here and must be decided before the manual process is retired; this spec fixes only the mechanism that makes any approved answer double-pay-proof.
- **Clock/timezone on hold window** → hold elapse is computed in UTC from `session_deliveries.delivered_at`, never from client time.
- **Legacy months** already aggregated into `teacher_payouts` → never re-paid by the new system (cutover date boundary, FR-021).

## Requirements *(mandatory)*

### Functional Requirements

**Onboarding & account state**

- **FR-001**: The system MUST create at most one Stripe Express account per teacher, initiated only by that teacher's authenticated session (server action / route handler using session `user.id` — never a client-supplied id) and only for profiles with role `teacher`.
- **FR-002**: All Stripe Connect API calls MUST run server-side with the secret key; no Connect account id, secret, or Account Link construction happens client-side. Account Links MUST be generated on demand and never persisted.
- **FR-003**: The system MUST maintain a `stripe_connect_accounts` mirror (teacher_id UNIQUE, stripe_account_id UNIQUE, charges_enabled, payouts_enabled, details_submitted, requirements summary, last_event_at) updated **only** by `account.updated` webhook events with a recency guard (same `last_event_at` floor pattern as `handlePaymentFailed`).
- **FR-004**: The teacher dashboard MUST show payout status (not started / in progress / action required / enabled) in Arabic and English, RTL-correct.

**Earnings & transfers**

- **FR-005**: Transfer eligibility MUST be derived exclusively from `session_deliveries` rows (created only by `finalize_attendance` after attendance confirmation). The system MUST NOT create earnings from bookings, schedules, or any unconfirmed state; cancelled and no-show sessions therefore can never pay (📖 lens).
- **FR-006**: Earning amount per delivery MUST be computed by one canonical, fully deterministic integer-cents rule from the **snapshotted** `session_deliveries.hourly_rate_usd` — never a live rate re-read: let `rate_cents = hourly_rate_usd × 100` (exact by construction — the snapshotted rate carries at most 2 decimal places, asserted); then `amount_cents = (duration_minutes × rate_cents + 30) ÷ 60` using integer division — i.e. round-half-up (ties away from zero) on the exact decimal value, with no binary floating-point anywhere in the calculation. JavaScript, Postgres, and the SC-002 parity tests against the legacy payroll path MUST all reuse this single rule (one shared pure function and one equivalent SQL expression, proven equal in tests). Course-purchase earnings MUST reuse `computeCourseRevenueSplit` unchanged.
- **FR-007**: A delivery with missing/zero snapshotted rate MUST NOT produce a transfer; it MUST surface as a structured exception (extending the `PayrollException` shape in `src/lib/domains/attendance/payroll.ts`).
- **FR-008**: Transfers MUST be created with Stripe idempotency key `transfer:{session_delivery_id}` AND backstopped by a DB `UNIQUE` on `teacher_transfers(session_delivery_id)` (partial, on non-clawback rows) — the dual-lock `billing_cycle_key` pattern. Re-running any sweep MUST create zero duplicates (provable by assertion).
- **FR-009**: Where the funding charge is identifiable, the Transfer MUST carry a `transfer_group` shared with that charge (checkout routes stamp `transfer_group` at PaymentIntent creation). Subscription-credit-funded deliveries use `delivery_{id}` as the group with no `source_transaction`.
- **FR-010**: Transfers MUST NOT be attempted before a configurable hold window (platform_settings key, default 7 days after `delivered_at`) has elapsed. ⚠ **HUMAN REVIEW (fiqh)**: the hold length delays wages already earned; a scholar/owner must approve the default and its justification (dispute protection) before live enablement — the spec does not decide this.
- **FR-011**: A failed transfer MUST leave the entry in `pending` with the Stripe error recorded and be retried by subsequent sweeps with capped backoff; it MUST never be silently marked paid or dropped (fail-closed).
- **FR-012**: USD only, matching every existing handler; a non-USD amount anywhere in the pipeline fails closed with a logged error.

**Refunds, disputes, clawback**

- **FR-013**: On `charge.refunded` for a linked charge, the system MUST reverse the teacher's share proportionally (integer cents, never exceeding what was transferred), idempotent on `reversal:{refund_id}:{transfer_id}` plus a DB unique backstop.
- **FR-014**: If the reversible amount is insufficient, the shortfall MUST be recorded as teacher debt and offset against future transfers only per the human-approved policy (see US3-AS3 ⚠); until that policy is approved, debt rows accrue but are never auto-deducted.
- **FR-015**: On `charge.dispute.created` for a linked charge, all pending entries funded by that charge MUST move to `held` before any subsequent sweep; on `charge.dispute.closed` they MUST release (won) or void/claw back (lost). Dispute handling for prepaid lots in `handleChargeDisputed` is unchanged.
- **FR-016**: Every state transition on earnings/transfers MUST be an append-style, audited change: financial columns immutable after insert, status-only updates, enforced by trigger (same guard idiom as `guard_teacher_payouts_financials`).

**Security & data integrity**

- **FR-017**: Every new table MUST ship RLS in the same migration: teacher SELECT own rows, admin SELECT via `private.is_admin()`, INSERT/UPDATE service_role only (mirror the `20260619000003_payroll_tables.sql` policy set). No client-side writes to any money table, ever.
- **FR-018**: The Connect webhook endpoint MUST verify the raw request body against the **Connect** signing secret before touching the DB, fail-closed 400 on failure, and record every event in `billing_events` (reusing `markEvent`) — identical shell discipline to `src/app/api/stripe/webhook/route.ts`.
- **FR-019**: All migrations MUST be expand/contract-safe: new tables and nullable additive columns only; `teacher_payouts` and `session_deliveries` are not dropped, renamed, or narrowed. The manual-payroll contract phase is a later PR after the new path is proven in production.
- **FR-020**: New env vars (`STRIPE_CONNECT_WEBHOOK_SECRET`, and any Connect-specific config) MUST be added to `docs/agents/env-vars.md` in the same PR that reads them.

**Coexistence & migration**

- **FR-021**: A cutover date (platform_settings `connect_cutover_date`) MUST partition history: deliveries dated before it remain payable only via the legacy `run_monthly_payroll` path; deliveries on/after it are payable only via Connect transfers (the terminal `manual_paid` state — edge cases — is a settlement record that removes an entry from both paths, never a third rail). No delivery may be payable by both (assert in tests). The setting itself MUST be **database-enforced write-once**: a trigger permits only the single NULL → value transition (service-role), rejecting any later UPDATE or DELETE — moving the partition after payouts begin could make the same delivery payable by both paths or by neither. The initial write and every rejected mutation attempt MUST leave an auditable record (append-only audit row: actor, timestamp, attempted value).
- **FR-022**: `run_monthly_payroll` and its API wrapper remain callable and untouched until the contract-phase PR; the admin dashboard labels legacy months distinctly.

**Admin & teacher visibility**

- **FR-023**: Admins MUST be able to place/lift a per-teacher payout hold with a required reason; both actions audit-logged. The sweep MUST check holds inside the same transaction that claims an entry (no TOCTOU pay-during-hold).
- **FR-024**: Teachers MUST see their own earnings ledger (pending/held/paid/clawed-back, with amounts and session references) — transparency of wages is itself a trust requirement (🎓 lens).

### Key Entities

- **Connect Account Mirror** (`stripe_connect_accounts`): one row per teacher; local truth for payouts_enabled/charges_enabled/requirements, updated only via `account.updated` with recency guard.
- **Earning Entry** (`teacher_earning_entries`): one row per payable unit — one canonical unique source key per kind (`session_delivery_id` UNIQUE for sessions; `payment_id` UNIQUE for course purchases). Amount in integer cents, snapshotted. States: `pending → held → transferred | voided`, plus a sweep-internal `processing` claim state (lease held while a sweep calls Stripe — see plan Phase 1) and a terminal `manual_paid` state (admin-recorded off-Stripe settlement, excluded from sweep eligibility — edge cases); plus negative `clawback` rows. Financial columns trigger-immutable.
- **Transfer Record** (`teacher_transfers`): one row per Stripe Transfer or Reversal; stores stripe_transfer_id, idempotency key, transfer_group, amount_cents (negative for reversals), status, error detail.
- **Teacher Debt**: derivable balance (sum of un-recovered clawbacks); no auto-deduction until policy approval (FR-014).
- **Payout Hold**: per-teacher (admin/manual or dispute-driven) with reason + actor; blocks the sweep.
- **Transfer Group**: Stripe-side string linking a charge to its teacher transfers; stamped at checkout when the funding charge maps to one teacher.

### Out of Scope

- Retiring/contracting the legacy payroll tables or RPC (later PR, after production proof — FR-019/022).
- Stripe **destination charges** / application-fee model (we keep separate charges & transfers; revisit only if Connect fees force it).
- Teacher-facing tax documents (1099/DAC7) — Stripe Express dashboard covers the teacher's own view; platform tax ops is a separate effort.
- Alternative payout rails for Connect-unsupported countries (flagged for human decision, edge case above).
- Any change to spec 036 marketplace search/rank/publish gates.
- Multi-currency.

## Success Criteria *(mandatory)*

- **SC-001**: A test-mode teacher goes from "no account" to "payouts enabled" purely through the product UI + Stripe hosted onboarding, with zero admin intervention.
- **SC-002**: For a month of seeded confirmed sessions, automated transfers match the legacy `run_monthly_payroll` aggregation to the cent, teacher by teacher (parity assertion in the local DB walk).
- **SC-003**: Running the transfer sweep N times produces exactly the same set of transfers as running it once (idempotency proof: DB row count + Stripe test-mode transfer count both unchanged).
- **SC-004**: A full refund → clawback round trip leaves the teacher's net for that charge at exactly 0 cents; a 50% partial refund leaves exactly the un-refunded share (floor rule), asserted in tests.
- **SC-005**: `charge.dispute.created` to entries-held latency is one webhook delivery — no sweep can pay a disputed entry (proven by a test that races the sweep against the hold).
- **SC-006**: No cancelled or no-show session ever produces an earning entry (negative test at the DB level).
- **SC-007**: RLS proof: an authenticated non-owner teacher and an anonymous client each read zero rows from every new table; `npm run sb:advisors` reports no new findings.
- **SC-008**: All gates green: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`, and `scripts/check-migration-safety.sh` passes on every migration.

## Assumptions

- The platform Stripe account will gain Connect (Express) capability once live (EIN pending); until then everything runs in test mode — the plan isolates live-only steps (see plan Phase 6).
- `profiles.hourly_rate_usd` (`20260619000000_profiles_hourly_rate.sql`) remains the per-session rate source, snapshotted into `session_deliveries` at finalize time; this spec adds no new rate fields.
- Subscription revenue is pooled (credits), so most session transfers are funded from platform balance without `source_transaction`; the platform accepts the resulting balance-timing requirement (charge settles before transfer — the hold window more than covers Stripe's settlement time).
- n8n may later trigger the sweep on a schedule; the sweep itself is an idempotent server-side function, so the trigger mechanism (cron route, n8n, admin button) is interchangeable.
- ⚠ **HUMAN REVIEW register (must be signed off before live enablement, none decided by this spec)**: (a) hold-window length (FR-010); (b) debt deduction policy and teacher consent (FR-014); (c) unsupported-country fallback; (d) whether teacher compensation timing/terms need updating in the teacher agreement.

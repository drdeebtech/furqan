# Feature Specification: Stripe Connect Teacher Payouts

**Feature Branch**: `feat/040-stripe-connect-payouts`
**Created**: 2026-07-15
**Updated**: 2026-07-16 — business rules finalized by the owner (Principal Payments Architect brief), incl. the 7-day student refund window (FR-031) and the 30-day agreement grace period (FR-029). HUMAN REVIEW register **CLOSED** (see Decisions Register).
**Status**: Draft — business rules final, awaiting implementation
**Replaces**: manual monthly payroll flip (`teacher_payouts.status` pending → paid, done by hand today)

> **Numbering note**: this spec was briefly filed as `038-stripe-connect-payouts`, which collided with the
> pre-existing `specs/038-prepaid-hour-wallet` (merged 2026-07-09, PR #660). Renumbered to **040**
> (`037-public-teacher-profile`, `038-prepaid-hour-wallet` and `039-shannon-audit-remediation` are all taken).
> No code referenced the old path.

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

1. **Given** a `session_deliveries` row exists (attendance finalized = CONFIRMED) and the teacher has `payouts_enabled=true` and no active hold, **When** the transfer sweep runs after the 14-day hold window elapses (measured from session completion, FR-010), **Then** exactly one Transfer is created for `duration_minutes / 60 × hourly_rate_usd`, converted to integer cents (📖 lens: pay only for sessions actually taught).
2. **Given** a session was cancelled or marked no-show, **Then** no `session_deliveries` row exists and **no transfer is ever attempted** — eligibility is derived from the delivery ledger, not from bookings.
3. **Given** the sweep crashes after calling Stripe but before writing its DB row, **When** it re-runs, **Then** the Stripe idempotency key (`transfer:{session_delivery_id}`) returns the original Transfer and the DB `UNIQUE(session_delivery_id)` backstop prevents a duplicate row — mirroring the `billing_cycle_key` pattern in `src/lib/domains/billing/orchestrate.ts`.
4. **Given** a teacher has `hourly_rate_usd` missing or 0, **Then** no transfer is created and a structured exception surfaces to ops (same fail-closed posture as spec 021's FR-030 in the existing payroll RPC — never a $0 payout, never a guessed rate).
5. **Given** the originating charge is identifiable (single-session or course purchase), **Then** the charge and its transfer share a `transfer_group` so the money is traceable end to end; **Given** the session was funded by pooled subscription credits, **Then** the transfer carries a `transfer_group` of the delivery id and is funded from platform balance (no `source_transaction`).
6. **Given** the platform's available Stripe balance cannot cover a transfer, **Then** the transfer attempt fails closed, the entry stays `pending` with the error recorded, and it is retried on the next sweep — earnings are never silently dropped or double-sent.

---

### User Story 3 — Refund Claws Back Teacher Earnings (Priority: P2)

A student is refunded for a charge whose session(s) already paid the teacher. The platform reverses the corresponding transfer(s) so the teacher does not keep earnings for refunded money.

**Why this priority**: Without clawback, every refund is a direct platform loss and an accounting hole; with wrong clawback, teachers are underpaid — both are money-integrity failures.

**Independent Test**: Stripe test mode: create charge → transfer → refund the charge via Stripe CLI; assert a Transfer Reversal is created for exactly the transferred amount tied to that charge's `transfer_group`, and a negative clawback row appears in the ledger summing the teacher's net to the correct value. Then seed a second delivery for the same teacher and run the sweep: assert the new earning is reduced by the outstanding debt (or fully consumed with the debt carried forward) **before** `stripe.transfers.create` is called.

**Acceptance Scenarios**:

1. **Given** a full refund on a charge with one linked transfer, **When** `charge.refunded` arrives, **Then** a Transfer Reversal for the full transfer amount is created (idempotent on `reversal:{refund_id}:{transfer_id}`), and a negative `teacher_transfers` clawback entry records it.
2. **Given** a partial refund, **Then** the reversal is proportional to the refunded fraction of the teacher's share, computed in integer cents with the platform absorbing the sub-cent remainder (inverse of the rounding rule in `src/lib/courses/revenue-split.ts` — never claw back more than the teacher received).
3. **Given** the transfer's reversible balance is smaller than the clawback owed (teacher already paid out), **Then** the reversal is capped at the reversible amount and the shortfall is recorded as a **teacher balance debt (negative balance)** which is **automatically offset against future earnings before any subsequent transfer** (FR-014). **DECIDED 2026-07-16 (owner)**: the platform does not absorb instructor-fault chargebacks or late refunds. The 📖 fairness requirement is met by *informed consent*, not by absorbing the loss: no earnings may accrue until the teacher has explicitly accepted the Teacher Agreement, which defines the debt-deduction policy in plain terms (FR-028/FR-029). A teacher who never consented can never be auto-deducted, because they can never have accrued earnings.
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
- **Teacher's Connect account is rejected/disabled by Stripe** → entries stay `pending`; ops alert. An admin may switch the teacher to the manual rail (`payout_method='manual'`, FR-025), after which the sweep routes their entries to `manual_due` for off-Stripe settlement (FR-026/FR-027) instead of leaving them stranded.
- **Transfer succeeds at Stripe but our webhook confirming it is delayed/lost** → the DB row was written synchronously at creation; `transfer.*` webhooks only reconcile status, never create rows.
- **Refund arrives for a charge spanning multiple sessions/entries** → clawback distributes proportionally across that charge's entries, oldest first, integer cents, remainder to platform.
- **Duplicate webhook delivery (any event)** → `billing_events` UNIQUE + per-object unique keys make every handler a no-op on replay.
- **Teacher in a country Stripe Connect doesn't support** → **DECIDED 2026-07-16 (owner)**: they are accounted for automatically and paid manually. An admin sets `payout_method='manual'` (FR-025); earnings materialize and accrue exactly as for any other teacher, the sweep skips the Stripe API call and marks them `manual_due` (FR-026), and an admin settles off-platform (bank transfer / Wise) and records the settlement with an external `reference_id` (FR-027). Every guarantee still holds: one earning per delivery, no double pay, full audit trail, cutover partition (FR-021) unaffected — the manual rail is a *settlement method*, never a second earnings ledger.
- **Clock/timezone on hold window** → hold elapse is computed in UTC from `session_deliveries.delivered_at` (the session **completion** timestamp), never from client time and never from the payment/charge date (FR-010).
- **Teacher has not accepted the Teacher Agreement** → they cannot accept bookings (FR-029), so no delivery and therefore no earning can exist for them. Existing teachers at rollout are handled by the backfill in FR-029 — the gate must never silently freeze live bookings.
- **Refund/chargeback lands after the 14-day hold, when the teacher is already paid** → clawback caps at the reversible amount and the remainder becomes a negative balance auto-offset against future earnings (FR-014). This is the designed tail-cover: the hold shortens exposure, it does not eliminate it (see FR-010 rationale).
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
- **FR-010**: **Time-based eligibility — DECIDED 2026-07-16 (owner): 14 days.** Transfers MUST NOT be attempted until `session_deliveries.delivered_at + connect_payout_hold_days <= NOW()` (UTC), where `connect_payout_hold_days` is a `platform_settings` key with default **14**. The window MUST be measured from the session's **completion** timestamp (`delivered_at`), **never** from the payment/charge date — a session paid for in advance (subscription credit, prepaid hours) must not start its hold before it is taught. The sweep MUST apply this condition inside the same atomic claiming statement that selects the entry (no TOCTOU).
  - **Configurability**: the value lives in `platform_settings` (DB), consistent with `connect_cutover_date` and the single-session price keys — **not** an env var, so there is exactly one source of truth and an admin change takes effect on the next sweep without a deploy. A corrupt/missing value MUST fail closed (no transfer), never default to 0 days.
  - **Rationale**: the hold outlasts the **7-day student refund window** decided on 2026-07-16 (FR-031), leaving a 7-day buffer for the refund to be requested, processed and land as a `charge.refunded` webhook before the teacher's money leaves the platform. `hold(14) = refund_window(7) + processing_buffer(7)`; if FR-031's window is ever changed, this value MUST be re-derived from it (single dependency, asserted in tests).
  - ⚠ **What the hold does NOT cover — deliberate, not an oversight**: card-network **chargebacks** are not bounded by our refund policy (schemes commonly allow ~120 days from the charge). No commercially sane hold covers that window, so FR-014's negative-balance recovery remains **load-bearing** for the tail, and FR-015's dispute hold protects money not yet transferred. Anyone reading FR-031 as "the exposure is now closed" is wrong: it closes the *refund* half only.
  - 📖 lens: a hold delays wages already earned, which requires justification and disclosure. Both are satisfied: the justification is dispute/refund exposure, and FR-028 requires the 14-day hold to be explained in the Teacher Agreement the teacher accepts *before* any earnings accrue.
- **FR-011**: A failed transfer MUST leave the entry in `pending` with the Stripe error recorded and be retried by subsequent sweeps with capped backoff; it MUST never be silently marked paid or dropped (fail-closed).
- **FR-012**: USD only, matching every existing handler; a non-USD amount anywhere in the pipeline fails closed with a logged error.

**Refunds, disputes, clawback**

- **FR-013**: On `charge.refunded` for a linked charge, the system MUST reverse the teacher's share proportionally (integer cents, never exceeding what was transferred), idempotent on `reversal:{refund_id}:{transfer_id}` plus a DB unique backstop.
- **FR-014**: **Debt-deduction / negative balances — DECIDED 2026-07-16 (owner): automatic offset.** If the reversible amount is insufficient (or the session was already paid out), the shortfall MUST be recorded as a negative ledger entry, and the teacher's balance MUST be allowed to go negative (**negative carryover**). Before **every** `stripe.transfers.create`, the sweep MUST net the teacher's outstanding negative balance against the claimed earning:
  - `transfer_cents = max(0, earning_cents − outstanding_debt_cents)`; the consumed amount reduces the debt.
  - If `transfer_cents == 0`, **no Stripe call is made** — the earning is consumed entirely by debt recovery and the entry closes as `debt_recovered` (a terminal, non-paying state) with the remaining debt carried forward.
  - Recovery MUST be recorded as its own append-only ledger row (`kind='debt_recovery'`, linked to both the consuming entry and the debt it offsets) so the netting is **idempotent on replay** — a retried sweep must never double-recover, and the arithmetic must be reconstructable from the ledger alone.
  - Netting MUST occur inside the same atomic claim that selects the entry (FR-016 immutability + no TOCTOU), and in integer cents only.
  - Debt MUST NOT be collected by any other means (no invoicing a teacher, no charging a card) — recovery is exclusively by offsetting future earnings. A teacher who stops teaching simply retains an uncollected balance; writing it off is an admin action, audit-logged.
  - **Consent precondition**: auto-deduction is only lawful/ethical here because FR-028/FR-029 guarantee no earning can exist without a prior, explicit acceptance of the Teacher Agreement that discloses this policy.
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
- **FR-024**: Teachers MUST see their own earnings ledger (pending/held/paid/clawed-back, with amounts and session references) — transparency of wages is itself a trust requirement (🎓 lens). The ledger MUST also surface any outstanding negative balance and each debt-recovery deduction with its cause (which refund/chargeback), so a deduction is never a silent surprise.

**Alternative payouts — manual rail (Connect-unsupported countries)**

- **FR-025**: `teacher_profiles` MUST carry `payout_method` (`stripe_connect` | `manual`, NOT NULL, default `stripe_connect`). It is **admin/service-role-writable only** — RLS MUST forbid a teacher from setting or changing their own `payout_method` (🛠 security: a self-served switch to `manual` would let a teacher route around Stripe into the human-paid export queue). Every change MUST be audit-logged (actor, timestamp, old → new).
- **FR-026**: The sweep MUST treat the manual rail as a *settlement method*, not a separate ledger: earning entries materialize, accrue, hold, clawback and debt-offset **identically** for both rails (same table, same FR-005/006/010/014 rules). Where `payout_method='manual'`, the sweep MUST claim the entry, apply the hold-window and debt-offset rules as usual, and then **SKIP the Stripe API call**, moving the entry to `manual_due` instead of `transferred`. No Connect account, no `stripe_connect_accounts` row, and no `payouts_enabled` check is required for a manual-rail teacher (FR-003's gate applies to the Stripe rail only).
- **FR-027**: Admins MUST be able to export `manual_due` entries (teacher, amount, session references, period) and then record settlement via a **secure server action**: admin-only (`requireRole`), zod-validated, requiring a non-empty external `reference_id` (bank/Wise reference) and recording actor + timestamp. The action MUST be:
  - **fail-closed and atomic** — a single conditional update (`WHERE status='manual_due' AND payout_method='manual'`) so it can never settle a Stripe-rail entry, never settle an entry twice (replay is a no-op returning the existing settlement), and never settle an entry that is `held`, `voided` or already `transferred`;
  - **idempotent** on `(entry_id)`, with `external_reference_id` UNIQUE per teacher to catch a pasted-twice reference;
  - terminal — `manual_paid` is final; financial columns remain immutable (FR-016).
- **FR-027a**: A teacher on the manual rail MUST NOT be exempt from any money-integrity rule: cutover partition (FR-021), no-double-pay, dispute holds (FR-015) and debt offset (FR-014) all apply. Tests MUST assert that an entry can never be both `manual_paid` and `transferred`, and that a `payout_method` flip mid-flight cannot double-settle an in-flight entry (the claim state in the sweep is the serialization point).

**Student refund window (payout dependency)**

- **FR-031**: **DECIDED 2026-07-16 (owner): students may request a refund within 7 days of session completion.** The payout hold (FR-010) is derived from this number, so the two MUST stay coupled — a change to the refund window is a change to the hold, and tests MUST assert `connect_payout_hold_days >= refund_window_days + 7` rather than hard-coding 14 in two places.
  - **Ownership**: this is a **platform product policy**, not a payouts implementation detail. Spec 040 **consumes** it; it does not own it. To be a real policy it MUST be (a) published in the student-facing Terms (`src/app/(public)/terms/terms-content.tsx`) and (b) reflected in `.claude/product-marketing.md`, which today records refund ownership as an open go-live blocker. **Both are out of scope for this spec and MUST land before enablement** — a hold justified by an unpublished policy is justified by nothing.
  - ⚠ **This EXPANDS platform liability — the owner should decide it with that in mind.** Today's published Terms grant **no** post-completion refund right at all (`terms-content.tsx` states only a *pre-session cancellation* rule: "cancellation 24+ hours before the session: full refund. Within 24 hours: session is consumed."). FR-031 creates a new right to refund a session **already taught**. That is a revenue decision, not a formality, and it needs reconciling with the existing 24-hour cancellation line so students aren't told two different things.
  - **"Enforces" means published-and-honored, not code-enforced.** There is no automated student refund path today (refunds are case-by-case via support; the only programmatic refund is `src/lib/actions/admin/refund-prepaid-hours.ts`). Technically blocking a refund request after day 7 is **not** built and is out of scope here. The spec MUST NOT claim an enforcement that does not exist.
  - 📖 lens: a bounded, published refund window protects the student (clear recourse for a session that failed them) and the teacher (a finite, knowable period after which their pay is settled) — both are served only if the number is actually published.

**Teacher Agreement (consent before earnings)**

- **FR-028**: The platform MUST record explicit, versioned acceptance of the **Teacher Agreement** per teacher: `agreement_version`, `accepted_at`, `accepted_by` (session user), and evidence fields (IP, user-agent) — append-only, service-role write, never editable. The agreement text MUST legally establish:
  1. the teacher is an **Independent Contractor**, not an employee;
  2. explicit authorization of **source-deducted platform commission** (the platform's share is deducted at source; the teacher receives the net);
  3. the **14-day hold window** (FR-010) and why it exists;
  4. explicit consent to the **negative-balance / debt-deduction policy** (FR-014), including that refunds and chargebacks on already-paid sessions are recovered from future earnings.
  ⚠ **The agreement's legal wording is out of scope for engineering and MUST be produced/reviewed by a qualified professional before enablement** — this spec fixes the required clauses, the consent mechanism, and the evidence trail, not the prose.
- **FR-029**: Acceptance MUST be obtained **before any earnings can be paid**, enforced as a gate on **accepting bookings** (Milestone A / plan Phase 2). **DECIDED 2026-07-16 (owner): two populations, two rules.**
  - **New teachers** (onboarding on/after the enablement date): a **hard, immediate pre-booking gate** — no current-version acceptance ⇒ not assignable to any new booking, no grace, no exception.
  - **Existing active teachers** (the population at enablement): a **30-day grace period**. They keep taking bookings during grace. The set MUST be **snapshotted at enablement** — each existing active teacher is stamped `agreement_grace_until = enablement_ts + 30 days`; everyone else is NULL (⇒ hard gate). A snapshot, not a dynamic `created_at < X` predicate: the latter silently hands the grace to anyone who signs up during the window, which would defeat the hard gate for new teachers.
  - **Grace expiry**: at `now() > agreement_grace_until` with no acceptance, the teacher becomes non-assignable exactly like a new teacher. In-grace teachers MUST be warned (dashboard banner + notification) on a defined cadence; expiring a teacher into a silent block with no warning is a 🎓-lens failure.
  - **Earnings during grace — the consent invariant survives**: a grace-period teacher may *accrue* earnings while unsigned, but those entries MUST be created `held` with `hold_reason='agreement_pending'` and MUST NOT transfer, settle manually, or be debt-offset until acceptance is recorded; on acceptance they release to `pending` and pay normally. This is what keeps FR-014 honest: **no teacher is ever auto-deducted, and no teacher's money is ever moved, under terms they have not accepted** — while no booking is ever frozen. Holding (not voiding) is also the 📖-correct answer: they taught, so the money is theirs the moment they consent; the hold is mechanical (we cannot lawfully pay out under unaccepted terms, and we have no bank details without onboarding anyway), not punitive, and it is disclosed on their earnings page (FR-024).
  - **Every booking-creation path** MUST be enumerated and gated in the same PR (booking actions `src/lib/domains/booking/actions.ts`, class-offering enrollment `src/lib/actions/class-offerings.ts`, instant/single-session checkout `src/app/api/stripe/checkout/single-session/route.ts`, admin-created bookings) — a gate applied to only some paths is a false guarantee.
  - **Baseline for the snapshot**: production has **5 active teachers / 7 live bookings** (checked 2026-07-16); the enablement migration MUST record how many teachers it stamped, and a test MUST prove those teachers keep booking on day 1 and are blocked on day 31 if still unsigned.
  - **No coupling to marketplace visibility**: an unsigned teacher may still appear in `/teachers` search (spec 036's publish gate is unchanged). Payout-readiness (Connect status) remains explicitly **not** a booking gate — only agreement acceptance is.
- **FR-030a**: A new agreement **version** MUST require re-acceptance before the teacher's next booking, and MUST NOT retroactively alter already-accrued earnings or already-settled transfers (the accepted version at accrual time is the governing one — record `agreement_version` on the earning entry or derive it by timestamp, and assert it in tests).

### Key Entities

- **Connect Account Mirror** (`stripe_connect_accounts`): one row per teacher; local truth for payouts_enabled/charges_enabled/requirements, updated only via `account.updated` with recency guard.
- **Earning Entry** (`teacher_earning_entries`): one row per payable unit — one canonical unique source key per kind (`session_delivery_id` UNIQUE for sessions; `payment_id` UNIQUE for course purchases). Amount in integer cents, snapshotted. States: `pending → held → transferred | voided`, plus a sweep-internal `processing` claim state (lease held while a sweep calls Stripe — see plan Phase 1), a terminal `debt_recovered` state (earning fully consumed by negative balance, FR-014 — no Stripe call), and the manual-rail path `manual_due → manual_paid` (FR-026/FR-027, excluded from Stripe sweep eligibility at the DB level); plus negative `clawback` and `debt_recovery` rows. Financial columns trigger-immutable.
- **Teacher Payout Method** (`teacher_profiles.payout_method`): `stripe_connect` (default) | `manual`. Admin/service-role-writable only (FR-025); selects the settlement rail, never the earnings rules.
- **Manual Settlement**: the `manual_paid` transition plus `external_reference_id`, settling admin, and timestamp (FR-027) — the off-Stripe analogue of a Transfer Record, and the only evidence that money left the building on the manual rail.
- **Teacher Agreement Acceptance**: append-only record of `(teacher_id, agreement_version, accepted_at, accepted_by, ip, user_agent)` (FR-028); the consent precondition for FR-010's hold and FR-014's auto-deduction.
- **Agreement Grace** (`teacher_profiles.agreement_grace_until timestamptz NULL`): stamped **once**, at enablement, for the snapshotted set of then-active teachers (FR-029). NULL ⇒ hard gate. Service-role write only; never extended silently (an extension is an admin action, audit-logged).
- **Transfer Record** (`teacher_transfers`): one row per Stripe Transfer or Reversal; stores stripe_transfer_id, idempotency key, transfer_group, amount_cents (negative for reversals), status, error detail.
- **Teacher Debt / Negative Balance**: the teacher's running balance MAY be negative (negative carryover). Derived from the ledger as `sum(clawback rows) − sum(debt_recovery rows)`; automatically offset against future earnings before any transfer (FR-014), never collected by any other means, and always reconstructable from append-only rows.
- **Payout Hold**: per-teacher (admin/manual or dispute-driven) with reason + actor; blocks the sweep.
- **Transfer Group**: Stripe-side string linking a charge to its teacher transfers; stamped at checkout when the funding charge maps to one teacher.

### Out of Scope

- Retiring/contracting the legacy payroll tables or RPC (later PR, after production proof — FR-019/022).
- Stripe **destination charges** / application-fee model (we keep separate charges & transfers; revisit only if Connect fees force it).
- Teacher-facing tax documents (1099/DAC7) — Stripe Express dashboard covers the teacher's own view; platform tax ops is a separate effort.
- Drafting the **legal text** of the Teacher Agreement (engineering owns the mechanism, required clauses, gate and evidence trail — FR-028; a qualified professional owns the wording).
- Collecting teacher debt by any means other than offsetting future earnings (FR-014) — no invoicing, no card-on-file for teachers.
- Automating the manual rail's outbound payment (bank/Wise API). FR-026/FR-027 automate the *accounting*; the payment itself stays a human step by design.
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
- **SC-009**: A delivery completed 13 days ago produces no transfer; the same delivery at 14 days + 1 minute produces exactly one — and a session **paid for** 30 days before it was taught still starts its hold at completion, not at payment (asserted at the DB level, UTC).
- **SC-010**: Negative carryover round trip: teacher paid out → late refund creates a debt exceeding the reversible amount → next earning is netted (or fully consumed with the remainder carried) **before** any Stripe call; running the sweep N times recovers the debt exactly once (idempotency of `debt_recovery` rows), and the teacher's balance reconstructed from the ledger equals the expected cents.
- **SC-011**: A `payout_method='manual'` teacher's entries reach `manual_due` with **zero** Stripe API calls (asserted against a mocked client), are exported, and settle to `manual_paid` exactly once with a required `reference_id`; replaying the settle action is a no-op; the action refuses a `stripe_connect` entry.
- **SC-012**: A **new** teacher without a current-version agreement acceptance cannot be assigned a booking through **any** booking-creation path (parametrized negative test across every enumerated writer), while an unsigned teacher still appears in `/teachers` search (spec 036 unchanged).
- **SC-013**: Grace behaves exactly as specified: a snapshotted existing teacher books successfully on day 1 and on day 29 unsigned; is blocked on day 31 unsigned; a teacher created *during* the window gets no grace (hard gate from the first booking attempt).
- **SC-014**: Consent invariant under grace: sessions delivered by an unsigned grace teacher produce entries that are `held` with `agreement_pending`, are never transferred / never manually settled / never debt-offset while unsigned, and release to `pending` (payable, full amount) on acceptance — asserted at the DB level.
- **SC-015**: The hold is derived, not hard-coded: `connect_payout_hold_days >= refund_window_days + 7` holds by assertion (FR-031/FR-010), so changing the refund window can never silently leave the hold too short.

## Assumptions

- The platform Stripe account will gain Connect (Express) capability once live (EIN pending); until then everything runs in test mode — the plan isolates live-only steps (see plan Phase 6).
- `profiles.hourly_rate_usd` (`20260619000000_profiles_hourly_rate.sql`) remains the per-session rate source, snapshotted into `session_deliveries` at finalize time; this spec adds no new rate fields.
- Subscription revenue is pooled (credits), so most session transfers are funded from platform balance without `source_transaction`; the platform accepts the resulting balance-timing requirement (charge settles before transfer — the hold window more than covers Stripe's settlement time).
- n8n may later trigger the sweep on a schedule; the sweep itself is an idempotent server-side function, so the trigger mechanism (cron route, n8n, admin button) is interchangeable.
- ✅ **Decisions Register — CLOSED 2026-07-16 (owner, Principal Payments Architect brief).** All four items previously flagged for human review are decided and encoded above:
  | # | Question | Decision | Encoded in |
  |---|---|---|---|
  | (a) | Hold-window length | **14 days**, measured from session **completion** (`delivered_at`), DB-configurable, fail-closed | FR-010, SC-009 |
  | (b) | Debt deduction & consent | **Automatic offset** of negative balances against future earnings before any transfer; consent secured up-front via the Teacher Agreement | FR-014, FR-028, SC-010 |
  | (c) | Unsupported-country fallback | **Manual rail**: `payout_method='manual'` → accrue automatically, skip Stripe, admin settles with an external reference | FR-025–FR-027a, SC-011 |
  | (d) | Teacher agreement terms | **Required**, pre-booking: Independent Contractor, source-deducted commission, 14-day hold, negative-balance consent | FR-028–FR-030a, SC-012 |
  | (e) | Student refund window | **7 days** from session completion — the 14-day hold is derived from it (7 + 7 buffer) | FR-031, FR-010, SC-015 |
  | (f) | Agreement rollout | **30-day grace** for the snapshotted set of existing active teachers; **hard immediate gate** for every new teacher; earnings accrue `held` while unsigned | FR-029, SC-013, SC-014 |
- **Blocking prerequisites before enablement** (decided in policy, not yet real in product — none are engineering decisions):
  1. **Publish FR-031** in the student-facing Terms (`src/app/(public)/terms/terms-content.tsx`) and reconcile it with the existing 24-hour cancellation clause; update `.claude/product-marketing.md`, which still records refund ownership as an open go-live blocker. A hold justified by an unpublished policy is justified by nothing.
  2. **Teacher Agreement legal text** produced/reviewed by a qualified professional; engineering pins the version string (FR-028).
  3. **Enablement runbook step**: stamp `agreement_grace_until` for the snapshotted active-teacher set *in the same operation* that sets `connect_cutover_date` (FR-029) — the grace clock and the payout clock must start together, or existing teachers get a grace that started before anyone told them.

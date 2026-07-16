# Implementation Plan: Stripe Connect Teacher Payouts

**Spec**: `specs/040-stripe-connect-payouts/spec.md`
**Created**: 2026-07-15
**Updated**: 2026-07-16 — finalized business rules (14-day hold derived from a 7-day refund window, auto debt offset, manual rail, Teacher Agreement gate with a 30-day grace for existing teachers); Decisions Register CLOSED.
**Status**: Draft — business rules final, awaiting implementation

> Renumbered 038 → **040** (collision with the pre-existing `specs/038-prepaid-hour-wallet`, merged 2026-07-09).

## Technical Context

- **Stack**: Next.js App Router (server actions + route handlers), TypeScript strict, Supabase Postgres/RLS, Stripe SDK (already pinned — reuse the existing `getStripe()` factory used by `src/app/api/stripe/checkout/route.ts`).
- **Reused patterns** (do not reinvent):
  - Webhook shell: verify raw body → `billing_events` UNIQUE insert → dispatch (`src/app/api/stripe/webhook/route.ts` + `EventContext`/`markEvent` in `src/lib/domains/billing/webhook-handlers.ts`).
  - Dual idempotency lock: Stripe idempotency key + DB UNIQUE backstop (`buildCycleKey` / `billing_cycle_key` in `src/lib/domains/billing/orchestrate.ts`).
  - Immutable-financials trigger guard + RLS policy set (`supabase/migrations/20260619000003_payroll_tables.sql`).
  - Integer-cents split math (`src/lib/courses/revenue-split.ts`).
- **Hard sequencing constraint**: the live Stripe account does not exist yet (EIN pending). Phases 0–5 run entirely on **Stripe test mode + local Supabase**. Phase 6 is the only phase touching the live account and is gated on explicit owner actions.
- **Three lenses**: named per phase below. 📖 decisions: eligibility only from attendance-confirmed deliveries; no guessed rates; dispute-won earnings restored. 🛠: fail-closed money math, RLS-in-same-migration, service-role-only secrets, expand/contract. 🎓: teacher-visible earnings ledger, RTL status card, no marketplace-visibility coupling to payout state.

## Constitution Check

Checked against the **five** principles in `.specify/memory/constitution.md` (the authoritative list — there is no separate "20 principles" document) plus the security hard lines in `CLAUDE.md` §3.

| Constitution principle | How this plan complies |
|---|---|
| **I. Domain Ownership** (NON-NEGOTIABLE) | All payout logic lives in `src/lib/domains/payouts/**`; routes/actions are thin shells. The manual rail does **not** spawn a second ledger — one earnings domain, two settlement methods (FR-026). Legacy payroll stays in its own domain, untouched (FR-019). |
| **II. Loud Failures** (NON-NEGOTIABLE) | Zero-rate delivery → structured exception (FR-007); failed transfer → recorded error + retry, never silently paid (FR-011); corrupt `connect_payout_hold_days` → no transfer (FR-010); bad webhook signature → 400, no DB write (FR-018). No silent catch anywhere in the money path. |
| **III. Atomic Critical Paths, Best-Effort Side Effects** | The claim → debt-net → settle sequence is atomic per entry (single conditional UPDATE + lease); Stripe is called **outside** the transaction with a dual idempotency lock (FR-008/014). Notifications/analytics are best-effort and can never fail a payout. |
| **IV. Auth at the Boundary** | Onboarding + agreement actions take identity from `auth.getUser()`, never the body (FR-001/028); `payout_method` and manual settlement are admin/service-role only (FR-025/027); RLS in the same migration for every new table (FR-017); zod at every boundary. |
| **V. Tracer-Bullet Adoption** | Phases 0→6 are a working thin thread widened progressively (ledger → sweep → UI → webhooks → ops → live), each with its own gate; the whole path is dormant in production (`connect_cutover_date` NULL) until Phase 6. |

| `CLAUDE.md` §3 security hard line | Compliance |
|---|---|
| RLS on every table, same migration | Phase 0 migrations ship policies + `sb:advisors` gate |
| Service-role key server-only | Connect calls behind `import "server-only"` |
| `userId` from session, never input | Onboarding/agreement/settle actions all session-derived |
| zod at every boundary | Webhook fields + admin action inputs |
| Expand/contract migrations | Additive only; `check-migration-safety.sh` in gate |
| Typed events only | New `FurqanEvent` / `MIXPANEL_EVENTS` constants, no raw strings |
| Verify with `npm run build` | Every phase gate includes it |

## New Project Structure

```
supabase/migrations/2026XXXX_connect_accounts.sql        Phase 0
supabase/migrations/2026XXXX_earning_entries_transfers.sql
supabase/migrations/2026XXXX_payout_holds_settings.sql
src/lib/domains/payouts/
  connect-accounts.ts        account create/link/status mirror (server-only)
  earnings.ts                entry materialization from session_deliveries
  transfer-sweep.ts          eligibility query + transfer creation (idempotent)
  clawback.ts                refund/dispute math (pure fns + orchestration)
  *.test.ts                  vitest per module
src/lib/domains/billing/connect-webhook-handlers.ts      Phase 3
src/app/api/stripe/connect-webhook/route.ts              Phase 3 (thin shell)
src/app/teacher/dashboard/... payout status card + earnings page   Phase 2
src/app/admin/payouts/**                                 Phase 4
src/app/api/admin/payouts/sweep/route.ts                 Phase 4 (admin/cron trigger)
```

---

## Phase 0 — Data Model (local Supabase only)

**Deliverables**
1. `stripe_connect_accounts`: `teacher_id uuid UNIQUE FK profiles`, `stripe_account_id text UNIQUE`, `charges_enabled bool`, `payouts_enabled bool`, `details_submitted bool`, `requirements jsonb`, `last_event_at timestamptz`. RLS: teacher select own, admin select, service_role write.
2. `teacher_profiles.payout_method` (`stripe_connect` | `manual`, NOT NULL DEFAULT `'stripe_connect'`, additive nullable-safe rollout per expand/contract) + RLS/trigger ensuring **only** service_role/admin can write it (spec FR-025 — a teacher self-switching to `manual` would route around Stripe into the human-paid queue). Change audit row (actor, old → new).

3. `teacher_profiles.agreement_grace_until timestamptz NULL` — **the single grace contract** (spec FR-029; spec and plan MUST NOT state it two ways):
   - **Stamped once**, by the enablement operation, in the **same transaction** that sets `connect_cutover_date`, for exactly the set `teacher_profiles WHERE is_archived = false` evaluated at that instant; value = `enablement_ts + 30 days`.
   - **NULL ⇒ hard gate.** Every teacher created afterwards has NULL by default and MUST never be stamped by any automated path.
   - **Never recomputed.** No `created_at`-derived predicate anywhere; the column is the only source of truth for who has grace.
   - **Auditable**: the enablement operation records the stamped teacher count and the id set in an append-only audit row; any later change (extension, revocation) is an admin-only, audit-logged action, never silent.
   - Service-role/admin write only (same RLS posture as `payout_method`).

4. `teacher_agreement_acceptances`: `teacher_id`, `agreement_version text`, `accepted_at`, `accepted_by`, `ip inet NULL`, `user_agent text NULL`; append-only (no UPDATE/DELETE policy at all), service_role insert, teacher SELECT own, admin SELECT (spec FR-028). Unique on `(teacher_id, agreement_version)`.
   **Privacy controls for the evidence fields (`ip`, `user_agent`) — spec FR-028a**:
   - *Minimization*: these two fields are the **only** evidence captured — no device fingerprint, no geolocation, no session replay. `user_agent` truncated to 255 chars.
   - *Purpose limitation*: consent evidence only. They MUST NOT be read by any feature, exported to any admin CSV, or sent to any analytics sink (PostHog/Mixpanel/Sentry) — assert with a static test in the same PR (the `no-debit-invariant.test.ts` grep-guard idiom).
   - *Access*: no one reads them in-product. The teacher's own SELECT and the admin dashboard MUST use a view/`SELECT` list that **excludes** them; raw access is service-role only, for a documented legal request.
   - *Retention*: kept while the acceptance governs money (i.e. while any earning accrued under that version is unsettled) **plus the statutory contract-record period**, then purged by a scheduled job. The exact period is a **legal/owner input** (⚠ same review gate as the agreement text — engineering pins the mechanism and a configurable `agreement_evidence_retention_days`, not the number).
   - *Erasure vs legal hold*: on account deletion the acceptance row is retained but the evidence fields are nulled, **unless** an active dispute/legal hold flag is set on that teacher — deleting consent evidence mid-dispute would destroy the platform's own defence. Both branches audit-logged.

5. `teacher_earning_entries`: **one canonical source-key model — every payable unit has exactly one unique source key**: partial `UNIQUE(session_delivery_id) WHERE kind='session'` **and** partial `UNIQUE(payment_id) WHERE kind='course'`, so re-running materialization can never duplicate an earning from either source (FR-008 alignment). Plus `teacher_id`, `amount_cents int` (negative allowed only for `kind='clawback'`), `funding_charge_id text NULL`, `transfer_group text`, `status` enum `pending|processing|held|transferred|voided|debt_recovered|manual_due|manual_paid`, `hold_reason`, `claimed_at timestamptz NULL` (sweep lease — Phase 1), `external_reference_id text NULL` + `settled_by uuid NULL` + `settled_at timestamptz NULL` (manual rail, spec FR-027; partial `UNIQUE(teacher_id, external_reference_id)` to catch a pasted-twice reference), timestamps.
   `kind` MUST include `debt_recovery` alongside `session|course|clawback` (spec FR-014). **Complete contract for a `debt_recovery` row** (under-specified in the first draft — pin it before implementation):
   - `amount_cents`: **positive**, = the cents recovered (the sign convention: `clawback` rows are negative, `debt_recovery` rows are positive; balance = `sum(all rows)` over the teacher, which is negative while debt is outstanding). State this once and assert it — a mixed convention here is how a ledger silently inverts.
   - `consuming_entry_id` (FK → the earning entry whose payout funded the recovery) and `recovered_against_entry_id` (FK → the `clawback` row being paid down). Both NOT NULL for `kind='debt_recovery'`, both NULL for every other kind (CHECK-enforced).
   - Idempotency: partial `UNIQUE(consuming_entry_id) WHERE kind='debt_recovery'` — one recovery row per consuming entry, so a replayed sweep can never double-recover.
   - `teacher_id` denormalized (as on every row) so balance is a single-table aggregate with no joins.
   - Financial columns immutable (same trigger); no status lifecycle — the row *is* the event.
   - Written **inside** the claiming transaction that consumes the entry, never after the Stripe call.
   - Reversal rule (FR-011): if the funding transfer subsequently fails and the entry returns to `pending`, the recovery MUST be undone by a compensating append-only row (`kind='debt_recovery_reversal'`, negative), never by deleting or mutating the original — the debt must reappear intact and the ledger must remain append-only. Financial-columns immutable trigger (copy `guard_teacher_payouts_financials` idiom); status transitions constrained by trigger (e.g. `transferred` and `manual_paid` are terminal except clawback rows).
6. `teacher_transfers`: `entry_id FK`, denormalized `session_delivery_id uuid NULL`, `stripe_transfer_id text UNIQUE`, `idempotency_key text UNIQUE`, `amount_cents`, `kind transfer|reversal`, `status`, `error_detail`.
   **Transfer identity is entry-scoped, so it covers every earning kind** (spec FR-008; corrected 2026-07-16 — a `session_delivery_id`-only identity was undefined for `kind='course'` entries, whose source key is `payment_id`):
   - Canonical Stripe idempotency key: **`transfer:{entry_id}`** — one stable identity for session, course and any future kind. (The earlier `transfer:{session_delivery_id}` form is *not* usable for course earnings.)
   - Primary DB backstop: partial `UNIQUE(entry_id) WHERE kind='transfer'`.
   - Defence-in-depth for session earnings, retained: partial `UNIQUE(session_delivery_id) WHERE kind='transfer' AND session_delivery_id IS NOT NULL` — guarantees one transfer per delivery even if two entries ever pointed at the same delivery.
   - **Reconciliation must cover both kinds**: the SC-002 parity walk compares session earnings to `run_monthly_payroll`; course earnings have **no legacy counterpart** and MUST be reconciled instead against `computeCourseRevenueSplit` over the same period, asserted separately. A single "totals match payroll" assertion would silently ignore every course transfer.
   - Tests assert all three constraints plus a course-kind transfer round trip (idempotent on replay).
7. `payout_holds`: `teacher_id`, `source` `admin|dispute`, `reason text NOT NULL`, `created_by`, `released_at NULL`.
8. platform_settings keys: `connect_payout_hold_days` (**default 14** — decided 2026-07-16, spec FR-010; DB-only, no env twin; corrupt/missing value fails closed = no transfer, never 0 days), `connect_cutover_date` (NULL = new path disabled; **write-once** — DB trigger allows only the single NULL → value transition, service-role only, and audit-logs the write and every rejected mutation attempt, per FR-021).
9. Hold-window eligibility is expressed **only** as `delivered_at + (connect_payout_hold_days || ' days')::interval <= now()` in UTC (spec FR-010) — never against a payment/charge timestamp; the condition lives inside the Phase 1 claiming statement, not in application code. Add `refund_window_days` (default **7**, spec FR-031) as a sibling platform_settings key and assert `connect_payout_hold_days >= refund_window_days + 7` in tests (SC-015) — the hold is *derived* from the refund window, never independently hard-coded.
10. Entry materialization trigger or sweep-side backfill from `session_deliveries` rows with `delivered_at >= connect_cutover_date` (decision: **sweep-side derivation, no trigger on the hot finalize path** — keeps `finalize_attendance` untouched, which has a history of P0s).

**Verification gate**
- Fresh-apply walk: `supabase db reset` clean (per the fresh-apply lesson), then `scripts/check-migration-safety.sh` exits 0.
- Rolled-back SQL walk with assertions. **Assert the outcome, not the mechanism** — RLS and triggers fail differently, and asserting the wrong one produces a green test that proves nothing:
  - *Trigger-enforced* (raises an exception): UPDATE of `amount_cents` on an entry → assert it **raises**.
  - *RLS-enforced* (does **not** raise — an UPDATE the policy forbids simply matches **0 rows**): as an authenticated teacher, UPDATE own `payout_method` / `agreement_grace_until` → assert `row_count = 0` **and** re-SELECT proves the value is **unchanged** (FR-025/FR-029). Same for a forbidden INSERT into a money table: assert it raises `insufficient_privilege` *or* affects 0 rows depending on which layer denies it — pick per table and assert the actual denial, never a generic "it errored".
  - *Append-only* (`teacher_agreement_acceptances`): with no UPDATE/DELETE policy, a teacher's UPDATE matches 0 rows and the row is unchanged; assert both. A service-role UPDATE must be blocked by trigger → assert it raises.
  - Non-owner SELECT returns 0 rows.
  - Hold boundary: 13-day-old delivery not eligible, 14-day-old eligible (FR-010/SC-009).
  - Grace: a stamped teacher is assignable, a NULL-grace teacher is not (FR-029).
- `npm run sb:advisors` no new findings; `npm run db:types` regenerates cleanly (never blind-regen `src/types/database.ts` — apply the alias-section discipline from spec 026).

## Phase 1 — Domain Layer (pure logic + Stripe test mode, no UI)

**Deliverables**
1. `earnings.ts`: `deriveEarningCents(delivery)` (integer cents, FR-006), exception surfacing for zero/missing rate (FR-007), cutover partition (FR-021).
2. `transfer-sweep.ts`: single idempotent function with an **explicit claim/lease state** so two concurrent sweeps can never process the same entry. Step 1 (atomic claim): one `UPDATE … SET status='processing', claimed_at=now() WHERE status='pending' AND <eligible> RETURNING *` — eligibility (**14-day hold elapsed from `delivered_at`** per FR-010, teacher `payouts_enabled` *for the Stripe rail only*, no active hold, FR-023) evaluated inside this same claiming statement, so a concurrent sweep finds no `pending` row and claims nothing. Step 2 (still in the claim transaction, before any external call): **net the teacher's outstanding negative balance** via `debt.ts` (FR-014) — if the earning is fully consumed, write the `debt_recovery` row, close the entry `processing → debt_recovered`, and **make no Stripe call at all**. Step 2b (**manual rail**, FR-026): if `payout_method='manual'`, **skip Stripe entirely** and flip `processing → manual_due` for the admin export queue — same hold, same debt netting, same cutover partition, only the settlement differs. Step 3 (Stripe rail only, outside any DB transaction — never hold one open across the external call): the claimant calls `stripe.transfers.create` with `idempotencyKey: transfer:{session_delivery_id}`, `transfer_group` per FR-009, for the **net** amount. Step 4: write the `teacher_transfers` row and flip the entry `processing → transferred`. Failure path: record error, flip back `processing → pending` (FR-011) — and the `debt_recovery` row must be reversed or re-derivable so a retry nets identically (assert this explicitly; a debt consumed by a failed transfer must not vanish). Crash recovery: a `processing` entry whose `claimed_at` lease has expired (e.g. > 15 min) is returned to `pending` at the start of the next run — safe because the Stripe idempotency key replays the original Transfer and the FR-008 uniques block a duplicate row.
3. `clawback.ts`: pure `computeClawbackCents(refundedFraction, transferredCents)` (proportional, floor, capped) + orchestration for reversal/debt/void per FR-013, US3-AS4.
4. `debt.ts`: pure `netAgainstDebt(earningCents, outstandingDebtCents) → { transferCents, recoveredCents, remainingDebtCents }` (integer cents; `transferCents = max(0, earning − debt)`) + orchestration that writes the `debt_recovery` ledger row **inside the same atomic claim** as the entry it consumes (spec FR-014). Property tests: recovery never exceeds the earning; balance reconstructed from ledger rows always equals `sum(clawback) − sum(debt_recovery)`; replaying a sweep recovers exactly once.
5. `manual-settlement.ts`: the admin server action behind spec FR-027 — single conditional UPDATE (`WHERE status='manual_due' AND payout_method='manual'`), requires non-empty `reference_id`, records actor+timestamp, replay is a no-op, and it can never touch a `stripe_connect` entry.
6. Typed events: `payout.transfer_created`, `payout.transfer_failed`, `payout.clawback` via `FurqanEvent` + Mixpanel constants.

**Verification gate**
- `npm run test:unit` green with new tests: cents math property tests (split + clawback always sum exactly; never claw back more than transferred), sweep idempotency (mock Stripe: run twice, one create call), eligibility negatives (no delivery row / zero rate / held / **before the 14-day hold** / before cutover ⇒ no transfer), **debt netting** (SC-010: partial net, full consumption with carry-forward, recover-exactly-once on replay), **manual rail** (SC-011: zero Stripe calls asserted against the mocked client; settle action idempotent; refuses a `stripe_connect` entry).
- Stripe **test-mode** smoke: script creates a test Express account + real test transfer + reversal end to end (secret key via env, never inline — `op run`).
- SC-002 parity walk on local DB: seeded month, sweep totals == `run_monthly_payroll` totals per teacher, rolled back.

## Phase 2 — Teacher Onboarding UI  *(= "Milestone A — Onboarding")*

**Deliverables**
1. **Teacher Agreement acceptance (blocking, FR-028/FR-029)** — ships *before* the Connect card, because consent is the precondition for earnings, the 14-day hold and debt deduction:
   - Agreement screen (AR/EN, RTL-correct) rendering the versioned text; explicit affirmative action (checkbox + submit, no pre-ticked box, no implied consent by browsing); server action records `(teacher_id, agreement_version, accepted_at, accepted_by, ip, user_agent)` append-only, identity from session only.
   - **Booking gate**: a teacher without a current-version acceptance cannot be assigned a **new** booking. Enumerate and gate **every** booking-creation path in this same PR (`src/lib/domains/booking/actions.ts`, class-offering enrollment `src/lib/actions/class-offerings.ts`, instant/single-session checkout `src/app/api/stripe/checkout/single-session/route.ts`, any admin-created booking) — a gate on some paths is a false guarantee. Marketplace **visibility** is untouched (spec 036).
   - **Rollout — DECIDED (FR-029)**: **30-day grace** for the snapshotted set of existing active teachers (5 in prod as of 2026-07-16), **hard immediate gate** for every new teacher. The snapshot is stamped at enablement (`agreement_grace_until`), never computed dynamically from `created_at` (which would leak the grace to new signups). In-grace teachers get dashboard + notification warnings on a defined cadence; expiry blocks new bookings.
   - **Consent invariant under grace (FR-029/SC-014)**: an unsigned grace teacher keeps booking and teaching, but their entries materialize `held` with `hold_reason='agreement_pending'` — never transferred, never manually settled, never debt-offset — and release to `pending` at full value on acceptance. This is the linchpin that lets us avoid a platform freeze **without** ever moving money or deducting debt under unaccepted terms.
   - ⚠ The agreement **text** is legal work, not engineering — the screen renders whatever version the owner's professional supplies; the version string is what engineering pins.
2. Server action `startConnectOnboarding()`: session user only, role=teacher check, create-or-reuse account (FR-001), mint Account Link, redirect. Return/refresh routes handle expired links (edge case). Manual-rail teachers (FR-025) see a "payouts handled manually by the academy" state instead of the Connect card — never a broken onboarding link.
3. Dashboard payout-status card (4 states + manual, FR-004) + teacher earnings page (FR-024, incl. outstanding negative balance and each debt-recovery deduction with its cause), both AR/EN + RTL.

**Verification gate**
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.
- Browser screenshot + vision check of the agreement screen, the card and the earnings page **in Arabic RTL** (agent-browser; accessibility-tree pass alone is forbidden for this visual gate). ⚠ Known constraint: automated image vision is currently blocked by the local `Read` deny — the screenshots go to the owner for the human look until that is narrowed.
- Negative test: POSTing a foreign `teacher_id` in the action body changes nothing (session identity wins) — for both the agreement action and onboarding.
- SC-012 parametrized negative test: unsigned teacher blocked on **every** booking path; still visible in `/teachers` search.
- Grace proof (SC-013/SC-014): snapshotted teacher books on day 1 and day 29 unsigned, blocked on day 31; a teacher created during the window gets **no** grace; an unsigned grace teacher's delivered session produces a `held/agreement_pending` entry that no sweep will pay, and that releases to full value on acceptance.

## Phase 3 — Webhook Events (Stripe CLI fixtures, test mode)

**Deliverables**
1. `src/app/api/stripe/connect-webhook/route.ts`: thin shell — verify raw body against `STRIPE_CONNECT_WEBHOOK_SECRET` (fail-closed 400), `billing_events` UNIQUE insert, dispatch. Add the env var to `docs/agents/env-vars.md` in the same PR (FR-020).
2. Handlers in `connect-webhook-handlers.ts` (reusing `EventContext`/`markEvent`) — the Connect endpoint receives **connected-account events only**:
   - `account.updated` → recency-guarded mirror update (FR-003).
   - `transfer.created` / `transfer.reversed` → reconcile status only (rows are created synchronously by the sweep — webhooks never create money rows).
   - `payout.paid` / `payout.failed` (teacher's bank payout on the connected account) → informational status + ops alert on failure.
3. Platform-webhook extensions — refund/dispute events are charges on the platform account, so they are processed **only** by the existing `src/app/api/stripe/webhook/route.ts` (one authoritative path; the Connect endpoint is NOT subscribed to `charge.*`, so the shared `billing_events (stripe_event_id UNIQUE)` ledger can never see a two-endpoint race where the losing insert skips teacher clawback):
   - `charge.refunded` → stays on the existing `handleChargeRefunded` chain in `webhook-handlers.ts`: after the prepaid path, append teacher clawback (FR-013/014) — one shared root-cause path, not a parallel handler.
   - `charge.dispute.created` → extend the existing `handleChargeDisputed` with the FR-015 hold; prepaid behavior unchanged.
   - `charge.dispute.closed` → **new case added to the dispatch map in `src/app/api/stripe/webhook/route.ts`** (today the dispatcher routes only `charge.dispute.created`; unknown types fall to the ignored path, so without this explicit case won/lost disputes would never release, void, or claw back) → new `handleChargeDisputeClosed`: release (won) / void + clawback (lost) per FR-015.

**Verification gate**
- `stripe listen`/`stripe trigger` fixture run for each event type against local dev; assert DB effects per event, then **replay each event** and assert zero additional effect (SC-003/US3-AS5).
- Bad-signature and missing-signature requests return 400 with no DB write.
- Race test for SC-005: dispute hold vs. concurrent sweep — disputed entry cannot transfer.
- `npm run test:unit` + `npm run build` green.

## Phase 4 — Admin Ops Dashboard & Sweep Trigger

**Deliverables**
1. `/admin/payouts`: per-teacher state table (FR-023/US5), failed-transfer errors, **negative balances**, legacy-month labeling (FR-022), manual hold place/lift with reason (audit-logged), and `payout_method` switch (admin-only, audited — FR-025).
1b. **Manual-rail queue (FR-027)**: filter/export of `manual_due` entries (teacher, amount, session refs, period) + the secure settle action (admin-only, zod, required `reference_id`, atomic conditional update, replay-safe). Export contains no secrets and is audit-logged.
2. Sweep trigger: admin-only route `src/app/api/admin/payouts/sweep/route.ts` (zod-validated, admin-guarded) — n8n/cron can call it later without change.

**Verification gate**
- RLS proof (SC-007): non-admin and anon get zero rows/403 at DB and route level.
- Seeded six-state matrix renders correctly; browser screenshot check (admin UI is LTR-primary but verify AR toggle).
- `npm run test:unit`, `npm run lint`, `npm run build`, coverage threshold intact (new logic lives in `src/lib` — mind the CI coverage gate).

## Phase 5 — Pre-Live Hardening (still test mode)

**Deliverables**
1. Security review pass (security-reviewer agent) over: onboarding action, both webhook routes, sweep, admin actions.
2. E2E: Playwright journey — onboard (test data) → finalize attendance → sweep → refund → clawback — against local stack.
3. Docs: runbook section appended to the Stripe go-live runbook memory/doc (owner steps for Phase 6), env-vars table complete.

**Verification gate**
- `npm test` (Playwright) green; full gate suite (SC-008) green; zero unresolved ⚠ HUMAN REVIEW items *blocking-tagged* (they may remain open, but Phase 6 cannot start until (a),(b) from the spec's review register are signed off).

## Phase 6 — LIVE-ACCOUNT GATED (owner actions required — nothing here is buildable earlier)

**Owner actions (explicit, in order)**
1. Stripe live account activated (EIN arrives) — per the existing go-live runbook.
2. Enable **Connect** on the live account; complete the platform Connect profile/branding (Stripe dashboard, human-only).
3. Create the live Connect webhook endpoint → set `STRIPE_CONNECT_WEBHOOK_SECRET` (live) in Vercel env (owner; secrets never inline).
4. ✅ **Decisions Register CLOSED 2026-07-16** (hold = 14 days derived from a 7-day refund window, auto debt offset, manual rail, agreement required with a 30-day grace). Three **blocking prerequisites** remain — all owner/product, none engineering:
   - **Publish the 7-day refund window** (FR-031) in the student Terms (`src/app/(public)/terms/terms-content.tsx`, reconciling it with the existing 24-hour cancellation clause) and in `.claude/product-marketing.md`. The 14-day hold is justified *by* this policy; unpublished, it justifies nothing.
   - **Teacher Agreement legal text**, professionally drafted/reviewed; engineering pins the version string.
   - **Stamp `agreement_grace_until`** for the snapshotted active-teacher set in the **same operation** that sets `connect_cutover_date` — the grace clock and the payout clock must start together.
5. Set `connect_cutover_date` in platform_settings (this is the enable switch — NULL until now means the entire new path was dormant in production, which is why Phases 0–5 can merge to main safely before the account exists).

**Engineering actions**
1. Live smoke with one real internal/pilot teacher: onboarding → $-small real session → sweep → verify transfer in the live dashboard.
2. Run legacy payroll and Connect in parallel for one full month (dual-run, FR-021 partition prevents double pay); reconcile to the cent.
3. Only after a clean parallel month: schedule the contract-phase PR for legacy payroll (explicitly out of scope here).

**Verification gate**
- Cent-exact reconciliation report for the parallel month (SC-002 in production data, read-only queries).
- Sentry shows zero unhandled errors from `connect-webhook` route over the pilot window.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Transfer without `source_transaction` needs available platform balance | Hold window ≥ settlement time; FR-011 retry keeps entries pending, never lost |
| `finalize_attendance` regression (history of P0s) | Zero changes to it — sweep derives entries read-only from `session_deliveries` |
| Local RPC seam broken (known issue, memory) | Phase 0/1 money verification is done at the DB level (SQL walks), not through the JS RPC seam |
| Double pay across legacy/new paths | `connect_cutover_date` partition + test asserting exclusivity (FR-021) |
| Webhook secret confusion (two endpoints, two secrets) | Separate routes, separate env vars, both in env-vars.md; bad-signature tests per route |
| Coverage gate drop (logic in `src/lib`) | Tests written per module in Phase 1 before UI phases |
| **Agreement gate freezes live bookings** (5 teachers / 7 bookings in prod) | FR-029 mandates a backfill or grace date + a test proving existing teachers keep booking; gate ships with every booking path enumerated in one PR |
| **Debt consumed by a transfer that then fails** → earning lost | Phase 1 failure path must reverse or re-derive the `debt_recovery` row; explicit test (a debt must never be silently paid twice or vanish) |
| **Teacher self-switches to the manual rail** to bypass Stripe | `payout_method` is service-role/admin-write only (FR-025), RLS-enforced + audited; negative test in the Phase 0 walk |
| Hold decoupled from the refund window (someone edits one, not the other) | `connect_payout_hold_days >= refund_window_days + 7` asserted in tests (SC-015); the hold is derived, never independently hard-coded |
| **Chargebacks exceed any hold** (~120 days under card-scheme rules) | Unavoidable by design — FR-014 negative-balance recovery is the tail cover, FR-015 holds not-yet-transferred money. FR-031 closes the *refund* half only; do not read it as closing the exposure |
| Grace leaks to new signups (dynamic `created_at` predicate) | Grace is a **stamped snapshot** at enablement, never computed (FR-029); test asserts a mid-window signup gets the hard gate |
| Unsigned grace teacher's money moved under unaccepted terms | Entries materialize `held/agreement_pending`; no transfer, no manual settle, no debt offset until acceptance (SC-014) |
| Grace expiry silently blocks a working teacher | Warning cadence (dashboard + notification) mandated in Phase 2; expiry is loud, not silent |

# Implementation Plan: Stripe Connect Teacher Payouts

**Spec**: `specs/038-stripe-connect-payouts/spec.md`
**Created**: 2026-07-15
**Status**: Draft

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

| Rule | How this plan complies |
|---|---|
| RLS on every table, same migration | Phase 0 migrations include policies + advisors gate |
| Service-role server-only | Connect calls in `src/lib/domains/payouts/**` behind `import "server-only"`; onboarding is a server action |
| userId from session | Onboarding action reads `supabase.auth.getUser()`; ignores body ids |
| zod at boundaries | Webhook payload fields + admin action inputs zod-validated |
| Expand/contract migrations | Additive only; legacy payroll untouched; `check-migration-safety.sh` in gate |
| Typed events | New `FurqanEvent`/analytics names added via `emit.ts` / `MIXPANEL_EVENTS`, no raw strings |
| Verify with `npm run build` | Every phase gate includes it (server/client boundary risk in dashboard code) |

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
2. `teacher_earning_entries`: **one canonical source-key model — every payable unit has exactly one unique source key**: partial `UNIQUE(session_delivery_id) WHERE kind='session'` **and** partial `UNIQUE(payment_id) WHERE kind='course'`, so re-running materialization can never duplicate an earning from either source (FR-008 alignment). Plus `teacher_id`, `amount_cents int` (negative allowed only for `kind='clawback'`), `funding_charge_id text NULL`, `transfer_group text`, `status` enum `pending|processing|held|transferred|voided|manual_paid`, `hold_reason`, `claimed_at timestamptz NULL` (sweep lease — Phase 1), timestamps. Financial-columns immutable trigger (copy `guard_teacher_payouts_financials` idiom); status transitions constrained by trigger (e.g. `transferred` and `manual_paid` are terminal except clawback rows).
3. `teacher_transfers`: `entry_id FK`, denormalized `session_delivery_id uuid NULL`, `stripe_transfer_id text UNIQUE`, `idempotency_key text UNIQUE`, `amount_cents`, `kind transfer|reversal`, `status`, `error_detail`. Uniqueness backstops match FR-008 exactly: partial `UNIQUE(entry_id) WHERE kind='transfer'` **and** partial `UNIQUE(session_delivery_id) WHERE kind='transfer' AND session_delivery_id IS NOT NULL` — the spec's `teacher_transfers(session_delivery_id)` backstop, not `entry_id` alone; tests assert both constraints.
4. `payout_holds`: `teacher_id`, `source` `admin|dispute`, `reason text NOT NULL`, `created_by`, `released_at NULL`.
5. platform_settings keys: `connect_payout_hold_days` (default 7 — ⚠ pending human sign-off), `connect_cutover_date` (NULL = new path disabled; **write-once** — DB trigger allows only the single NULL → value transition, service-role only, and audit-logs the write and every rejected mutation attempt, per FR-021).
6. Entry materialization trigger or sweep-side backfill from `session_deliveries` rows with `delivered_at >= connect_cutover_date` (decision: **sweep-side derivation, no trigger on the hot finalize path** — keeps `finalize_attendance` untouched, which has a history of P0s).

**Verification gate**
- Fresh-apply walk: `supabase db reset` clean (per the fresh-apply lesson), then `scripts/check-migration-safety.sh` exits 0.
- Rolled-back SQL walk with assertions: insert delivery → derive entry → attempt UPDATE of `amount_cents` (must raise) → non-owner select returns 0 rows.
- `npm run sb:advisors` no new findings; `npm run db:types` regenerates cleanly (never blind-regen `src/types/database.ts` — apply the alias-section discipline from spec 026).

## Phase 1 — Domain Layer (pure logic + Stripe test mode, no UI)

**Deliverables**
1. `earnings.ts`: `deriveEarningCents(delivery)` (integer cents, FR-006), exception surfacing for zero/missing rate (FR-007), cutover partition (FR-021).
2. `transfer-sweep.ts`: single idempotent function with an **explicit claim/lease state** so two concurrent sweeps can never process the same entry. Step 1 (atomic claim): one `UPDATE … SET status='processing', claimed_at=now() WHERE status='pending' AND <eligible> RETURNING *` — eligibility (hold window elapsed, teacher `payouts_enabled`, no active hold, FR-023) evaluated inside this same claiming statement, so a concurrent sweep finds no `pending` row and claims nothing. Step 2 (outside any DB transaction — never hold one open across the external call): only the claimant calls `stripe.transfers.create` with `idempotencyKey: transfer:{session_delivery_id}`, `transfer_group` per FR-009. Step 3: write the `teacher_transfers` row and flip the entry `processing → transferred`. Failure path: record error, flip back `processing → pending` (FR-011). Crash recovery: a `processing` entry whose `claimed_at` lease has expired (e.g. > 15 min) is returned to `pending` at the start of the next run — safe because the Stripe idempotency key replays the original Transfer and the FR-008 uniques block a duplicate row.
3. `clawback.ts`: pure `computeClawbackCents(refundedFraction, transferredCents)` (proportional, floor, capped) + orchestration for reversal/debt/void per FR-013/014, US3-AS4.
4. Typed events: `payout.transfer_created`, `payout.transfer_failed`, `payout.clawback` via `FurqanEvent` + Mixpanel constants.

**Verification gate**
- `npm run test:unit` green with new tests: cents math property tests (split + clawback always sum exactly; never claw back more than transferred), sweep idempotency (mock Stripe: run twice, one create call), eligibility negatives (no delivery row / zero rate / held / before hold window / before cutover ⇒ no transfer).
- Stripe **test-mode** smoke: script creates a test Express account + real test transfer + reversal end to end (secret key via env, never inline — `op run`).
- SC-002 parity walk on local DB: seeded month, sweep totals == `run_monthly_payroll` totals per teacher, rolled back.

## Phase 2 — Teacher Onboarding UI

**Deliverables**
1. Server action `startConnectOnboarding()`: session user only, role=teacher check, create-or-reuse account (FR-001), mint Account Link, redirect. Return/refresh routes handle expired links (edge case).
2. Dashboard payout-status card (4 states, FR-004) + teacher earnings page (FR-024), both AR/EN + RTL.

**Verification gate**
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.
- Browser screenshot + vision check of the card and earnings page **in Arabic RTL** (agent-browser; accessibility-tree pass alone is forbidden for this visual gate).
- Negative test: POSTing a foreign `teacher_id` in the action body changes nothing (session identity wins).

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
1. `/admin/payouts`: per-teacher state table (FR-023/US5), failed-transfer errors, debts, legacy-month labeling (FR-022), manual hold place/lift with reason (audit-logged).
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
4. Sign off the HUMAN REVIEW register: hold-window length, debt-deduction policy, unsupported-country fallback, teacher-agreement wording.
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

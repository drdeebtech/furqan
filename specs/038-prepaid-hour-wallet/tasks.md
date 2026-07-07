# Tasks: 038 Prepaid Hour Wallet

Dependency-ordered. Each phase ends with a **gate** that must pass before the next starts.
Money-path phases require **local Postgres verification** (NFR-004), not just tsc/lint.

**Design authority:** `spec.md` → **Eng-review resolutions (2026-07-06)** section (R1–R10, H1–H5).
This tasks file already encodes those resolutions; do not revert to the pre-review wording.

Legend: `[ ]` todo · each task notes its lens and the file(s) it owns.

## Phase 0 — Recon & contracts (no code)

- [ ] T0.1 `gitnexus_impact` on `deduct_package_session`, `deduct_student_package` (confirm trigger), `selectActivePackage`, `finalize_attendance`, `restore_student_package`, the single-session Stripe route + webhook. Report blast radius; stop/warn on HIGH/CRITICAL. The shared debit kernel + selection are modified (R2/R3) — enumerate every caller.
- [ ] T0.2 Confirm the exact `packages` + `student_packages` shapes vs. what R1/R4/R9 add (`product_type` on student_packages, `rate_paid_usd`, `stripe_payment_intent_id`; seeded catalog row). Confirm `bookings.student_package_id` records the charged lot (needed for restore targeting, H4).
- [ ] T0.3 Confirm the confirm-time debit trigger applies the same soonest-expiry ordering as `selectActivePackage` (per ledger.ts comment) so R2's type-aware rank is applied in BOTH places consistently.
- [ ] T0.4 Confirm 1:1 booking duration handling (`duration_min`, validation.ts pro-rate) to lock R7's `duration_min = 60` precondition; identify where the individual-session precondition lives.
- **Gate:** written recon note in `research.md`; no HIGH/CRITICAL surprise unresolved.

## Phase 1 — Data model + settings (migration, expand-safe)

- [ ] T1.1 Seed ONE `packages` catalog row `product_type='prepaid_hours'`, `session_count=1`. 🛠
- [ ] T1.2 `student_packages`: add `product_type text DEFAULT 'subscription'` (R4), `rate_paid_usd numeric`, `stripe_payment_intent_id text`. Add **`UNIQUE(stripe_payment_intent_id)`** (H1, partial `WHERE stripe_payment_intent_id IS NOT NULL`). All nullable/defaulted (expand-safe, NFR-002). 🛠
- [ ] T1.3 New **`prepaid_hours_events`** table (R5): `id`, `package_id` FK, `event_type` (`grant|draw|restore|expired|refunded`), `hours_delta int`, `stripe_ref text`, `created_at`. RLS: student SELECTs own (join via package → student). Causation unique constraints: one `grant` per intent, one `draw` per booking, one `restore` per draw, one `refunded` per refund_request. 🛠🔒
- [ ] T1.4 **Append-only enforcement** on `prepaid_hours_events`: `BEFORE UPDATE OR DELETE` trigger raising an exception (H5 — RLS alone is bypassed by service-role). 🔒
- [ ] T1.5 Indexes (R9): partial `student_packages(student_id, expires_at) WHERE status='active'`; partial `student_packages(expires_at) WHERE product_type='prepaid_hours' AND status='active'`; `prepaid_hours_events(package_id, created_at)`. 🛠
- [ ] T1.6 Seed settings: `prepaid_hours_rate_usd=10`, `prepaid_hours_expiry_months=12`, preset sizes `5/10/20`, custom min/max, `reminder_lead_days`.
- [ ] T1.7 `migration-safety` guard passes; `sb:advisors` clean.
- **Gate:** fresh `supabase db reset` + bootstrap applies cleanly; RLS verified (student cannot read another student's wallet or events).

## Phase 2 — Grant + drawdown + restore + selection (DB functions)

- [ ] T2.1 `record_prepaid_event(p_package, p_event_type, p_hours_delta, p_stripe_ref)` — single append helper for all money fns (R5/R7-DRY). 🛠
- [ ] T2.2 `grant_prepaid_hours(p_payment_intent, p_student, p_hours, p_rate)` — inserts a **new lot** (R1), `product_type='prepaid_hours'`, `expires_at=now()+window`, `rate_paid_usd=p_rate`, `stripe_payment_intent_id=p_payment_intent`. Idempotent via the `UNIQUE(stripe_payment_intent_id)` claim in the SAME txn (H1) — redelivery is a no-op. Appends `grant` event. `FOR UPDATE` not needed (insert), but rely on the unique constraint for concurrency. 🛠🔒
- [ ] T2.3 Modify **`deduct_package_session`**: after a successful debit, `UPDATE ... SET expires_at = now()+window WHERE id = p_package_id AND product_type='prepaid_hours'` (R3 — gated; subscription rows untouched). Append `draw` event only for prepaid rows. `FOR UPDATE` on the row (H3). `CREATE OR REPLACE`, same signature (R10). 🛠🔒
- [ ] T2.4 Modify **`selectActivePackage`** + confirm-time trigger: `ORDER BY (product_type='prepaid_hours') ASC, expires_at ASC NULLS LAST` (R2 — subscription first, then soonest-expiry). Add an explicit "use a prepaid hour" override path that selects the soonest-expiry prepaid lot. 🛠
- [ ] T2.5 Extend **`finalize_attendance`** restore to `prepaid_hours` lots (idempotent, targets the exact charged lot via `bookings.student_package_id`; reactivates an expired lot's hour per H4). Appends `restore` event. Must NOT restore a subscription-absence into a wallet or vice-versa. 🛠
- [ ] T2.6 `EXECUTE` on all new/modified SECURITY DEFINER fns revoked from `anon`/`authenticated`, granted `service_role` (NFR-003). 🔒
- **Gate (LOCAL VERIFY):** in real Postgres — grant twice same intent (one lot); two purchases (two lots); dual-holder booking charges the SUBSCRIPTION (not wallet); override charges the soonest-expiry lot; subscription-only + wallet-only selection unchanged (**regression**); subscription debit does NOT reset `expires_at` (**regression**); concurrent last-hour double-book (no oversell); teacher-absent restores the exact lot exactly once, never cross-product (**regression**); several cycles.

## Phase 3 — Purchase flow (Stripe + webhook)

- [ ] T3.1 "Buy hours" checkout (feature-flagged, R10): server computes `amount = hours × prepaid_hours_rate_usd`, enforces custom min/max, creates a `mode:"payment"` session with a **pending purchase row**. Reject any client-supplied amount (fail-closed). `userId` from session only. 🛠🔒
- [ ] T3.2 Webhook: on `payment` success, reconcile against the pending row and verify `payment_status`, currency, amount, quantity, customer, ownership (H2); handle delayed-payment events; then call `grant_prepaid_hours` idempotently. No grant without a matching pending row (fail-closed). 🔒
- [ ] T3.3 Unit tests: price computation, client-tamper rejection, idempotent grant (redelivery), concurrent first-purchase (unique constraint), no-debit-into-subscription invariant, unauthenticated rejection.
- **Gate:** test-mode purchase grants the correct hours once; webhook redelivery does not double-grant.

## Phase 4 — Expiry (sweep + reminder)

- [ ] T4.1 Booking precondition already ignores `expires_at < now()` (deduct guard + `status='active'` selection); add a test to prove defense-in-depth (FR-008).
- [ ] T4.2 Scheduled sweep: `UPDATE student_packages SET status='expired' ... WHERE product_type='prepaid_hours' AND status='active' AND expires_at < now()` with row lock + **re-check `expires_at` after locking** (H3); appends `expired` event per lot (R6). Idempotent (no double event).
- [ ] T4.3 n8n pre-expiry reminder at `reminder_lead_days` before a lot's `expires_at`.
- **Gate (LOCAL VERIFY):** dormant lot expires + cannot be spent; active lot (recent use) untouched; concurrently renewed lot not erased by the sweep; reminder payload correct.

## Phase 5 — Refund (admin, webhook-driven saga)

- [ ] T5.1 `reserve_prepaid_refund(p_lot, p_hours, p_refund_request_id)` — admin-only; locks the lot, blocks over-refund/already-spent, marks `refund_pending` (unspendable), records the request. Pro-rated at the lot's **frozen `rate_paid_usd`** (R8). 🛠🔒
- [ ] T5.2 Issue Stripe refund against the lot's original payment intent with `idempotency_key = refund_request_id`. On the `charge.refunded` webhook, **finalize**: void the exact hours + append `refunded` event (idempotent). On Stripe failure, release the reservation. 🔒
- [ ] T5.3 `charge.refunded` / `charge.dispute` webhooks also reconcile **external** refunds/disputes/chargebacks by voiding the corresponding lot (H5) — wallet never stays spendable after money is reversed.
- [ ] T5.4 Admin surface to approve a refund request (feature-flagged).
- **Gate (LOCAL VERIFY):** one approval → one Stripe refund → exact unused hours voided; repeat approval is a no-op; a simulated Stripe-side refund voids the lot; over-refund blocked.

## Phase 6 — Student & pricing UI (RTL, feature-flagged)

- [ ] T6.1 `/pricing`: third "Pay as you go — buy hours" option (presets + custom); honest copy from `policies.ts` incl. "one 60-minute session" (R7). Behind the flag. 🎓
- [ ] T6.2 Student dashboard: wallet balance = SUM of active prepaid lots + soonest expiry + purchase/drawdown/restore history from `prepaid_hours_events`. 🎓
- [ ] T6.3 Booking UI: when both subscription + wallet exist, explicit "use subscription credit (default) vs use a prepaid hour" choice (R2 override). Only offer wallet for 60-min slots (R7).
- **Gate (VISUAL):** screenshot `/pricing` + dashboard at 375/768/1440, AR RTL + EN; mushaf/Arabic rendering unaffected (vision check, not a11y tree).

## Phase 7 — Policy copy + marketing announcement

- [ ] T7.1 `policies.ts`: add `PREPAID_HOURS_POLICY` (flat $10/60-min-session, rolling expiry window, refund-on-request) AR/EN short+long. 📖🎓
- [ ] T7.2 `/pricing` FAQ (`site_faqs`/policies) reflects wallet terms.
- [ ] T7.3 Update `.claude/product-marketing.md` + `docs/marketing-plan.md`: third pay option, rate, expiry, refund; retire "hourly not directly purchasable online" (supersedes decision #42). Reconcile with PR #653 accuracy fixes.
- **Gate:** copy matches code (single source `policies.ts`); no contradiction with `/pricing`.

## Phase 8 — Ship

- [ ] T8.1 `npm run build` + `tsc` + `lint` + `test:unit` green (build, not just tsc).
- [ ] T8.2 Code review (money path → security-reviewer + database-reviewer); address CRITICAL/HIGH.
- [ ] T8.3 `gitnexus_detect_changes` scope check; PR with test plan + local-verification evidence. Confirm the feature flag is OFF at merge; document the flip-on step after migration confirmed (R10).
- **Gate:** all reviews clean; PR green; local money-path evidence attached; flag OFF at merge.

## Cross-cutting (every phase)

- Atomic · idempotent · fail-closed · `FOR UPDATE` on every money op (H3) · RLS + append-only enforcement · `userId` from session · expand/contract · RTL · no secrets client-side · feature-flagged surfaces (R10).
- Per repo rule "Claude plans, OpenCode implements": implementation of each phase is delegated to the builder agent, with Claude reviewing + independently verifying money-path phases (2/3/4/5) locally.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | (not run; demand/cannibalization noted as premise risk) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_resolved | 12 issues, 0 critical gaps, 0 unresolved |
| Outside Voice | Codex (gpt-5.5) | Independent 2nd opinion | 1 | issues_found | 11 findings; 4 became decisions, 5 folded as hardening (H1–H5), 2 already covered |
| Design Review | `/plan-design-review` | UI/UX (RTL surfaces) | 0 | — | recommended next (Phases 6–7 add public RTL surfaces) |

- **CODEX:** Found real gaps the section review missed — purchase-lot provenance, session-hour units, non-atomic refund, deploy sequencing. All absorbed into R1/R7/R8/R10 + H1–H5.
- **CROSS-MODEL:** Claude review + Codex agreed the reuse of `student_packages` is right; Codex sharpened the *shape* of the reuse (per-purchase lots, not a topped-up row). No standing disagreement — all 4 tensions resolved in Codex's direction.
- **VERDICT:** ENG CLEARED (plan hardened, all decisions resolved) — ready to implement. Design review recommended before shipping Phases 6–7 (public RTL surfaces).

NO UNRESOLVED DECISIONS

## BUILD STATE (2026-07-07) — branch `feat/038-prepaid-hour-wallet`, pushed

**Phases 1–7 + the Phase-8 review are DONE, verified, and backed up on origin. The feature is flag-OFF (`prepaid_hours_purchase_enabled` default false) and does NOT go live on merge — it stays dark until go-live (below).**

- **Phase 1–5 (backend money path):** schema, functions, sweep, refund saga — each verified on local Postgres with rolled-back DO-block walks (money-chain, sweep 3-case, refund 6-case).
- **Phase 6 (UI):** T6.1 /pricing "Pay as you go" card, T6.2 dashboard wallet, T6.3 "use my hours" booking picker — browser + vision gated (AR RTL + EN; picker locks to 60-min); T6.3's confirm-time debit verified by a 3-case walk (prepaid-debited / subscription-debited / fail-closed).
- **Phase 7 (copy/docs):** PREPAID_HOURS_POLICY + invariant tests; product-marketing.md "Pay as you go" (supersedes decision #42); /pricing FAQ.
- **Phase 8 review:** security-reviewer + database-reviewer ran on the full diff. **No CRITICAL/HIGH introduced by 038.** Migration ordering verified for both from-zero AND prod incremental-apply. Hardening applied: server-side 60-min guard in createBooking.
- **Adjacent security find (NOT 038):** a pre-existing all-bookings "free session" hole (bookings_insert RLS didn't constrain status/student_package_id) was fixed + shipped to production standalone as **PR #664** (RLS role walk verified; migration `20260717000000`).

### Why the branch is build-RED right now (EXPECTED — do not "fix" with casts)
`webhook-handlers.ts` + `ledger.ts` reference prepaid RPCs/columns (grant_prepaid_hours, product_type, use_prepaid_hours, …) not yet in `src/types/supabase.generated.ts`. Per this repo's own convention, `supabase.generated.ts` is synced **after** migrations reach the live schema, via a standalone `chore(types): regen` commit (precedent: #655, #552, #544). `db-types-fresh` CI only runs when the generated file or `src/lib/supabase/migrations/**` changes — 038 touches neither — so it does not block. The 9 tsc errors self-resolve at go-live step 2. Forcing green early with throwaway casts on payment code is premature and NOT best practice.

### GO-LIVE RUNBOOK (push-button; only when Manaracode EIN + Stripe are ready)
Stripe is the ONLY external blocker (EIN pending → no Stripe account/keys). The DB + code below are Stripe-independent and can even land DARK before Stripe if desired.
1. **Merge `feat/038` to main** → `supabase-migrate.yml` applies the 6 prepaid migrations to the live DB (safe: additive, expand/contract, from-zero CI green). Feature stays invisible (flag off).
2. **Sync types:** `npm run db:types` (regenerates `supabase.generated.ts` from the now-migrated live schema) → commit as `chore(types): regen for prepaid hour wallet` → the 9 tsc errors clear, build green.
3. **When Stripe is live** (EIN → Stripe account → `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in Vercel env; register the `charge.refunded` + `charge.dispute.created` webhook events): flip `prepaid_hours_purchase_enabled='true'` in `platform_settings`. The /pricing card, checkout, and booking picker become visible.
4. **Confirm live:** buy a small bundle via Stripe test→live, verify the wallet balance + a booking drawdown.

### DEFERRED FOLLOW-UPS (logged — none are blockers; do when their path is wired)
- **T5.4 admin refund action** (skeleton only; needs Stripe) — build when Stripe is live; then apply the two refund hardenings: (a) `reconcile_external_prepaid_refund` should void the REFUNDED slice proportionally, not all remaining hours; (b) `reserve_prepaid_refund` should RAISE on a `released`-status refund id.
- **Cron sweep route** `src/app/api/cron/prepaid-hours-sweep/route.ts` (wraps `sweep_expired_prepaid_hours`; Stripe-independent) + n8n reminder against `prepaid_hours_reminder_lead_days`.
- **LOW:** add `OR p_rate <= 0` guard in `grant_prepaid_hours` (defended downstream today).

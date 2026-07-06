# Tasks: 038 Prepaid Hour Wallet

Dependency-ordered. Each phase ends with a **gate** that must pass before the next starts.
Money-path phases require **local Postgres verification** (NFR-004), not just tsc/lint.

Legend: `[ ]` todo · each task notes its lens and the file(s) it owns.

## Phase 0 — Recon & contracts (no code)

- [ ] T0.1 `gitnexus_impact` on `deduct_student_package`, `finalize_attendance`, the single-session Stripe payment route + its webhook handler, and the individual-session booking precondition. Report blast radius; stop/warn on HIGH/CRITICAL.
- [ ] T0.2 Confirm the exact `student_packages` shape and which columns exist vs. must be added (`rate_paid_usd`, `expires_at`, `product_type` enum value, `stripe_payment_intent_id`).
- [ ] T0.3 Confirm how individual-plan booking currently selects its credit source (settles the D-drawdown-order default). Write it into spec §Drawdown order.
- [ ] T0.4 Confirm `credit_action` vocabulary + how to add `expired` / `refunded` without breaking the guard/enum (expand-safe).
- **Gate:** written recon note in `research.md`; no HIGH/CRITICAL surprise unresolved.

## Phase 1 — Data model + settings (migration)

- [ ] T1.1 Migration: add `product_type='prepaid_hours'` support, `rate_paid_usd`, `expires_at`, `stripe_payment_intent_id` (nullable/defaulted, expand-safe) to `student_packages`; index on `(student_id, product_type, expires_at)`. 🛠
- [ ] T1.2 Migration: seed settings `prepaid_hours_rate_usd=10`, `prepaid_hours_expiry_months=12`, preset sizes, custom min/max, reminder_lead_days.
- [ ] T1.3 RLS + policies for any new column/row visibility in the SAME migration; students see only their own wallet; writes only via SECURITY DEFINER fns. 🛠🔒
- [ ] T1.4 `migration-safety` guard passes; `sb:advisors` clean.
- **Gate:** fresh `supabase db reset` + bootstrap applies cleanly; RLS verified (student cannot read another's wallet).

## Phase 2 — Grant + drawdown + restore (DB functions)

- [ ] T2.1 `grant_prepaid_hours(p_payment_intent, p_student, p_hours, p_rate)` — idempotent per payment intent; sets `expires_at = now + window`; additive-never-reset. 🛠
- [ ] T2.2 Extend drawdown so a live wallet package is a valid individual-session source; atomic (`FOR UPDATE`); resets `expires_at`. 🛠
- [ ] T2.3 Extend `finalize_attendance` restore to `prepaid_hours` packages (idempotent, targets the exact package charged). 🛠
- [ ] T2.4 `EXECUTE` on all new SECURITY DEFINER fns revoked from anon/authenticated. 🔒
- **Gate (LOCAL VERIFY):** simulate in real Postgres — grant twice with same intent (one grant), book to draw down, concurrent double-book (no oversell), teacher-absent restore (exactly one), several cycles.

## Phase 3 — Purchase flow (Stripe + webhook)

- [ ] T3.1 "Buy hours" checkout: server computes amount, creates `mode:"payment"` session with a pending purchase row (reuse single-session pattern). Reject client amount. 🛠🔒
- [ ] T3.2 Webhook: on `payment` success call `grant_prepaid_hours` idempotently.
- [ ] T3.3 Unit tests: price computation, client-tamper rejection, idempotent grant, no-debit-into-subscription invariant.
- **Gate:** test-mode purchase grants the correct hours once; webhook redelivery does not double-grant.

## Phase 4 — Expiry (sweep + reminder)

- [ ] T4.1 Booking precondition ignores `expires_at < now` packages (defense in depth).
- [ ] T4.2 Scheduled sweep voids expired credits, records `expired` ledger event.
- [ ] T4.3 n8n pre-expiry reminder at reminder_lead_days.
- **Gate (LOCAL VERIFY):** dormant wallet expires + cannot be spent; active wallet (recent use) does not expire; reminder payload correct.

## Phase 5 — Refund (admin, support-initiated)

- [ ] T5.1 `refund_prepaid_hours(p_package, p_hours)` — admin-only, pro-rated at frozen `rate_paid_usd`, voids hours, idempotent; blocks over-refund. 🛠🔒
- [ ] T5.2 Stripe refund against original payment intent; reconcile in ledger.
- [ ] T5.3 Admin surface to approve a refund request.
- **Gate (LOCAL VERIFY):** one refund voids exact unused hours + one Stripe refund; repeat approval is a no-op.

## Phase 6 — Student & pricing UI (RTL)

- [ ] T6.1 `/pricing`: add the third "Pay as you go — buy hours" option (presets + custom); honest copy from `policies.ts`. 🎓
- [ ] T6.2 Student dashboard: wallet balance + expiry + purchase/drawdown history; explicit source choice when both plan + wallet held (D-drawdown-order UI). 🎓
- [ ] T6.3 Booking UI: when both sources exist, make "use subscription credit vs use hour" explicit.
- **Gate (VISUAL):** screenshot `/pricing` + dashboard at 375/768/1440, AR RTL + EN; mushaf/Arabic rendering unaffected.

## Phase 7 — Policy copy + marketing announcement

- [ ] T7.1 `policies.ts`: add `PREPAID_HOURS_POLICY` (rate, rolling expiry window, refund-on-request) AR/EN short+long. 📖🎓
- [ ] T7.2 `/pricing` FAQ (`site_faqs` / policies) reflects wallet terms.
- [ ] T7.3 Update `.claude/product-marketing.md` + `docs/marketing-plan.md`: third pay option, rate, expiry, refund; retire "hourly not directly purchasable online" (supersedes decision #42 copy). Reconcile with the accuracy fixes in PR #653.
- **Gate:** copy matches code (single source `policies.ts`); no contradiction with `/pricing`.

## Phase 8 — Ship

- [ ] T8.1 `npm run build` + `tsc` + `lint` + `test:unit` green (build, not just tsc).
- [ ] T8.2 Code review (money path → security-reviewer + database-reviewer); address CRITICAL/HIGH.
- [ ] T8.3 `gitnexus_detect_changes` scope check; PR with test plan + the local-verification evidence.
- **Gate:** all reviews clean; PR green; local money-path evidence attached.

## Cross-cutting (every phase)

- Atomic · idempotent · fail-closed · RLS · `userId` from session · expand/contract · RTL · no secrets client-side.
- Per repo rule "Claude plans, OpenCode implements": implementation of each phase is delegated to the builder agent, with Claude reviewing + independently verifying money-path phases (2/3/4/5) locally.

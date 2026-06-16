# Implementation Plan: Subscription Billing Foundation (Schema + Stripe Subscriptions)

**Branch**: `018-subscription-billing-foundation` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/018-subscription-billing-foundation/spec.md`
**Phase**: م٠ (data design) + م١ (Stripe Subscriptions foundation) of the Subscription + Courses Pivot

## Summary

Establish the recurring-billing rails for the platform pivot: four new tables (`subscription_plans`, `stripe_customers`, `subscriptions`, `billing_events`) with RLS + financial-column guards shipped in the same migration, plus a real Stripe Subscriptions integration (Checkout in subscription mode, Customer Portal, signature-verified webhook ingestion) that grants monthly session credits **idempotently** into the **existing** `student_packages` debit kernel. Stripe is the source of truth; the local mirror is reconcilable. The grant-on-payment path reuses the hardened SECURITY DEFINER pattern and records the `payments` row + the credit grant **atomically** in one SQL function. All financial side effects are gated behind webhook signature verification (fail-closed). Replaces the current 501 stubs at `src/app/api/stripe/checkout/route.ts` and `src/app/api/stripe/webhook/route.ts`.

## Technical Context

**Language/Version**: TypeScript (strict), Next.js App Router (canary/modified — verify APIs against `node_modules/next/dist/docs/`); Node 24; Postgres 15 (Supabase).
**Primary Dependencies**: Stripe Node SDK (**to be added** — currently absent), `@supabase/supabase-js` admin client (`src/lib/supabase/admin.ts`), existing `src/lib/security/secrets.ts` (HMAC/constant-time compare), `src/lib/stripe/fulfillment.ts` (extend), `src/lib/automation/emit.ts` (`emitEvent`).
**Storage**: Supabase Postgres. New tables in `supabase/migrations/<UTC ts>_*.sql` after the `20260428000000_remote_baseline.sql` baseline (never `db push` the baseline). Reuses `student_packages`, `payments`, `invoices`, `profiles`, `platform_settings`, `automation_logs`.
**Testing**: Vitest (`test:unit`) for grant idempotency / fail-closed unit coverage; local Postgres simulation (brew/Docker) for the money migration per NFR-003; Playwright (`npm test`) for the checkout→grant E2E in Stripe test mode.
**Target Platform**: Vercel (Fluid Compute) serverless; Stripe test mode until go-live (FR-019: live keys by config only).
**Project Type**: Web application (Next.js full-stack, single repo).
**Performance Goals**: Webhook handler returns within Stripe's timeout; grant is O(1) per invoice (no fan-out). p95 webhook processing < 2s.
**Constraints**: USD only (non-USD rejected, FR-008); no financial side effect before signature verification (NFR-001); service-role-only writes on all billing tables; secrets server-only.
**Scale/Scope**: Sized for **50,000 users** (constitution). Grants are per-invoice webhook-driven — **no nightly cron fan-out**. `billing_events` and `subscriptions` are the growth tables; both indexed on lookup keys; `billing_events` append-only ledger with a retention note (below).

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md`. Re-checked post-design.*

### I. Domain Ownership (NON-NEGOTIABLE) — ⚠ REQUIRES ADR

Subscription billing is **net-new owner-domain surface**: it owns `subscriptions`, `subscription_plans`, `stripe_customers`, `billing_events` and emits new canonical billing events (subscription activated / renewed / past-due / canceled). Per Principle I, a new owner-domain requires (a) this `spec.md` ✅, (b) an **ADR amending the Domains list**, and (c) a `CONTEXT.md` Domains update.

**Resolution**: Treat billing as an extension of the existing **Package** domain (it grants `student_packages`) rather than minting a brand-new domain, *OR* author **ADR-0005 "Billing/Subscription owner-domain"**. Decision recorded in [research.md](./research.md) R1. Domain code lands in `src/lib/domains/billing/` with an orchestrator `orchestrate.ts` for the grant choreography. **Gate status: PASS conditional on ADR-0005 being committed in the implementation PR** (tracked as task 0 in tasks.md).

### II. Loud Failures (NON-NEGOTIABLE) — PASS

Checkout/portal server actions wrap in `loudAction`. The webhook route is an API handler (no server action) but: every grant failure pipes through `logError`; no empty `catch {}`; no `?? []`/`?? null` after Supabase calls. `emitEvent` runs post-commit, non-blocking.

### III. Atomic Critical Paths, Best-Effort Side Effects — PASS (core requirement)

The paid-invoice path (record `payments` row + create `student_packages` grant + mark cycle granted) is **one Postgres SECURITY DEFINER function** with BEGIN/COMMIT semantics (FR-015) — not chained client calls. External Stripe verification happens before any DB write. `emitEvent`/notify are post-commit and never roll back the grant.

### IV. Auth at the Boundary — PASS

Checkout/portal routes call `requireRole`/`requireAuth`; student identity from session, never request input (FR-010). Webhook route authenticates via **Stripe signature** (not a user session) and is the sole exception — verified fail-closed before any read/write (FR-012, NFR-001). Domain grant functions receive structured, already-trusted input.

### V. Tracer-Bullet Adoption — PASS

Net-new feature through the full spec-kit pipeline. One pilot plan (this), one test plan row exercised end-to-end before generalizing tiers (spec 019).

### Scale Target (50k, NON-NEGOTIABLE) — PASS with notes

- **No per-render column writes**; grants are per-invoice events.
- **No unbounded admin UPDATE/DELETE**; lifecycle changes are per-subscription.
- **No nightly cron fan-out**: renewals are Stripe-driven webhooks, not a 50k×N cron.
- **RLS predicates** on `subscriptions`/`stripe_customers`/`student_packages` use `( select auth.uid() ) = student_id` with a btree index on `student_id` — sized against a multi-million-row table.
- **`billing_events` growth**: append-only; expected ≈ a few rows per subscriber per month. Note in research.md R5: index on `stripe_event_id` (unique) + `subscription_id`; a retention/partition strategy is **out of scope here** but flagged for ops (not a blocker at 50k for the foreseeable horizon).

### Branch Hygiene (NON-NEGOTIABLE) — PASS

Plan's first implementation task is "open draft PR same day"; PR body will carry `Closes #<issue>`. Work happens on `018-subscription-billing-foundation` cut from main. Pre-work checks (`gh issue view`, `gh pr list`, `git log --grep`, `git log --diff-filter=D`) run before coding (tasks.md task 1).

**Overall gate: PASS** — single tracked condition: commit **ADR-0005** (or the "extend Package domain" decision) in the implementation PR. No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/018-subscription-billing-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1..Rn
├── data-model.md        # Phase 1 — tables, columns, RLS, guards, grant fn
├── quickstart.md        # Phase 1 — local Stripe test-mode + Postgres verify runbook
├── contracts/           # Phase 1 — route + webhook + SQL-fn contracts
│   ├── checkout.contract.md
│   ├── portal.contract.md
│   ├── webhook.contract.md
│   └── grant-function.contract.md
├── checklists/
│   └── requirements.md  # already complete
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/api/stripe/
│   ├── checkout/route.ts        # REPLACE 501 stub → subscription-mode Checkout
│   ├── portal/route.ts          # NEW → Customer Portal session
│   └── webhook/route.ts         # REPLACE 501 stub → verify + route events
├── lib/
│   ├── domains/billing/
│   │   ├── orchestrate.ts       # grant choreography (post-verify)
│   │   ├── plans.ts             # plan-catalog reads
│   │   ├── subscriptions.ts     # mirror upsert (recency-guarded)
│   │   └── events.ts            # canonical billing event names (enum)
│   ├── stripe/
│   │   ├── client.ts            # NEW server-only Stripe SDK init
│   │   └── fulfillment.ts       # EXTEND: subscription grant alongside one-time
│   ├── security/secrets.ts      # REUSE verify (or Stripe constructEvent)
│   └── supabase/admin.ts        # REUSE service-role client
└── types/supabase.generated.ts  # regenerate via npm run db:types

supabase/migrations/
└── <UTC ts>_subscription_billing_foundation.sql  # tables + RLS + guards + grant fn

tests/
├── unit/billing/                # idempotency, fail-closed, recency, USD-guard
└── e2e/                         # checkout→grant in Stripe test mode

docs/adr/
└── 0005-billing-subscription-domain.md   # ADR (Constitution gate I)
```

**Structure Decision**: Web-application layout. Domain logic consolidates under `src/lib/domains/billing/` (Principle I); route adapters stay thin and call the orchestrator (Principle I/IV); the atomic grant is a SQL function in one timestamped migration (Principle III); types regenerate to `src/types/supabase.generated.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New owner-domain surface (billing) | The pivot's entire revenue model is recurring subscriptions; nothing existing owns subscription lifecycle | Folding into Package domain is the fallback (research.md R1); either way an ADR records the decision — not an unjustified deviation |
| New SECURITY DEFINER grant function | Atomic payment+grant+cycle-mark (Principle III, FR-015) cannot be done with chained client calls without a double-grant window | Client-side multi-write rejected: not atomic, races on webhook retry |

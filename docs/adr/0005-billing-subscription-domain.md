# ADR-0005: Billing/Subscription owner-domain

**Status**: Accepted
**Date**: 2026-06-16
**Supersedes/amends**: Domains list in `CONTEXT.md` (Constitution Principle I gate for spec 018)

## Context

The platform is pivoting from per-session (one-time package) billing to **monthly recurring subscriptions** (spec 018 — Subscription Billing Foundation). This introduces four net-new source-of-truth tables — `subscription_plans`, `stripe_customers`, `subscriptions`, `billing_events` — plus a new canonical event taxonomy (`subscription.activated` / `renewed` / `past_due` / `canceled`) and a new SECURITY DEFINER grant function `grant_subscription_cycle()`.

Constitution Principle I requires that every table's owner-domain be explicit and that minting a **new owner-domain** be recorded in an ADR that amends the Domains list in `CONTEXT.md`. The existing **Package** domain (`packages`, `student_packages`, `payments`, `invoices`) owns the session-credit *debit kernel* but does not model Stripe subscription lifecycle, the plan catalog, the customer mapping, or the billing-event ledger.

## Decision

Create an eighth owner-domain — **Billing** — under `src/lib/domains/billing/`.

The Billing domain **owns**:
- `subscription_plans` — the binding plan catalog mirror (what a paid cycle grants).
- `stripe_customers` — the 1:1 user ↔ Stripe customer mapping.
- `subscriptions` — the subscription lifecycle mirror.
- `billing_events` — the idempotent Stripe-event ledger.
- `grant_subscription_cycle()` — the atomic, idempotent payment + credit-grant SQL function (SECURITY DEFINER, service-role-only).
- The canonical billing event taxonomy: `subscription.activated`, `subscription.renewed`, `subscription.past_due`, `subscription.canceled`.

The Billing domain **grants into** the Package domain (it writes `student_packages` rows), but the subscription lifecycle, plan catalog, customer mapping, and event ledger are a distinct source of truth from Package's debit kernel. Package continues to own the *debit* side (`deduct_package_session`, `refund_package_session`, `restore_student_package`) unchanged.

Relationships:
- Billing → Package: a paid cycle creates a `student_packages` grant (additive, never overwriting — AGENTS.md §4) linked via `student_packages.subscription_id` + `student_packages.billing_cycle_key`.
- Billing → Automation: emits `subscription.*` events via `emitEvent` (post-commit, non-blocking) for downstream specs (023 reports/notifications, 021 seat-release).
- Billing ← routes: `POST /api/stripe/checkout`, `POST /api/stripe/portal`, and `POST /api/stripe/webhook` are thin route adapters that call the Billing orchestrator (`src/lib/domains/billing/orchestrate.ts`); the webhook authenticates via Stripe signature (not a user session) — the sole auth-boundary exception.

## Alternatives considered

1. **Fold subscription tables into the Package domain.** Rejected — Package's job is the debit kernel and one-time package purchases. Overloading it with Stripe subscription lifecycle, dunning, recency-guarded mirroring, and a separate event ledger would muddy Package's ownership and make the grant choreography harder to reason about. Package keeps the debit; Billing owns the recurring lifecycle.
2. **No domain; put the logic in the route adapters.** Rejected — violates Principle I (route adapters never inline choreography). The atomic grant is a SQL function; the route only verifies + dispatches.

## Consequences

- `CONTEXT.md` Domains list grows from seven to **eight** owner-domains.
- All writes to the four billing tables are service-role only; RLS allows student reads of their own subscription/customer rows, authenticated reads of the active plan catalog, and admin-only reads of `billing_events`.
- `grant_subscription_cycle()` is the **only** path that writes a subscription-driven `student_packages` grant (AGENTS.md §9). Routes never write `student_packages` directly.
- `student_packages.package_id` becomes nullable so a subscription grant (which has no `packages` row) can be inserted; the debit kernel keys on `student_packages.id`, so this does not affect debiting.

## Three-lens note

- 🛠 **Engineer**: reuses the hardened SECDEF + RLS + financial-guard patterns; the grant is atomic so there is no payment-without-grant window.
- 📖 **Quran teacher**: billing is the right to be taught; a grant is tracked exactly and is additive across cycles — a learner's memorization continuity is never reset by a renewal.
- 🎓 **Platform expert**: failed payment degrades to dunning, never a silent drop; the parent can always see what they pay for via the plan catalog and Customer Portal.

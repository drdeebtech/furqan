-- 20260727000000_pending_upgrade_grants.sql
--
-- Money-path fix (audit 2026-07-15): the immediate tier-upgrade route granted
-- delta session credits synchronously at request time — BEFORE the proration
-- invoice was confirmed paid, and independent of the outcome. A declined card
-- kept the credits (invoice.payment_failed performs no reversal). Worse, when
-- the proration invoice DID pay, handleInvoicePaid ran the full monthly
-- grantCycle on it too (no billing_reason filter) → delta + a full month,
-- double-granted.
--
-- Fix (mirrors the deferred-tier pattern, pending_tier_changes → applied at
-- invoice.paid): the route records the intended delta here, keyed to the
-- proration invoice; the invoice.paid webhook (billing_reason =
-- 'subscription_update') grants it and marks it applied. Payment failure →
-- the row is simply never consumed (Stripe smart-retries can still pay the
-- invoice later, so rows are NOT cancelled on payment_failed; unpaid rows
-- stay 'pending' and inert — fail-closed by construction).
--
-- expand-contract-ok: pure expand — new table only, no changes to existing
-- shapes. Safe to deploy concurrently with the running build.

create table if not exists public.pending_upgrade_grants (
  id                 uuid primary key default gen_random_uuid(),
  subscription_id    uuid not null references public.subscriptions(id),
  student_id         uuid not null references public.profiles(id),
  plan_id            uuid not null references public.subscription_plans(id),
  delta_sessions     integer not null check (delta_sessions > 0),
  -- Proration invoice this grant is gated on. UNIQUE = idempotency backstop
  -- for double-submission and webhook retries.
  stripe_invoice_id  text not null unique,
  status             text not null default 'pending'
    check (status in ('pending', 'applied', 'cancelled')),
  created_at         timestamptz not null default now(),
  applied_at         timestamptz
);

comment on table public.pending_upgrade_grants is
  'Delta-session grant for an immediate tier upgrade, deferred until the proration invoice is paid (invoice.paid, billing_reason=subscription_update). Unpaid → row stays pending and no credits are ever granted.';

-- Webhook lookup path: by invoice id (covered by the UNIQUE index) and the
-- fallback by (subscription_id, status='pending').
create index if not exists idx_pending_upgrade_grants_sub_pending
  on public.pending_upgrade_grants (subscription_id, created_at desc)
  where status = 'pending';

-- ── RLS — enabled + policies in the SAME migration (AGENTS.md §3) ────────────
alter table public.pending_upgrade_grants enable row level security;

-- Students may read their own pending/applied upgrade grants (transparency —
-- "why don't I have my credits yet?"). auth.uid() wrapped in a scalar
-- subquery per plan-caching best practice used across this schema.
create policy "student read own upgrade grants"
  on public.pending_upgrade_grants
  for select
  using (student_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies → only service_role (bypasses RLS) can
-- write. Writers: upgrade-tier route (insert) and the Stripe webhook
-- (status transition), both server-side admin clients.

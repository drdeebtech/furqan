-- Spec 039 / PayPal epic (#756) Phase 1 (#758) — provider-neutral recurring schema.
--
-- WHY. `subscriptions` is Stripe-shaped: no provider column, and both
--   stripe_subscription_id / stripe_customer_id are NOT NULL. Recurring billing
--   cannot be routed to PayPal without a provider column and neutral ref
--   columns. Mirrors the proven prepaid shape in
--   20260718000000_prepaid_payments_provider_agnostic.sql.
--
-- WHAT (foundation only — NO money-function change; grant_subscription_cycle is
--   Phase 2/#759):
--   • subscriptions.provider ('stripe'|'paypal', default 'stripe'),
--     provider_subscription_id, provider_customer_id — backfilled from the
--     stripe_* columns so history is complete; Stripe columns stay populated.
--   • provider-scoped unique index on (provider, provider_subscription_id) so a
--     Stripe and a PayPal subscription that share a ref string never collide.
--   • widen: drop NOT NULL on stripe_subscription_id / stripe_customer_id (a
--     PayPal row has neither).
--   • subscription_plans.paypal_plan_id (+ unique index).
--   • payments: paypal_sale_id (recurring PayPal arrives as PAYMENT.SALE.COMPLETED
--     with a SALE id, never an Order id) + widen the cross-field CHECK so a
--     recurring paypal row (order_id NULL, sale_id set) is accepted. One-time
--     paypal purchases keep using paypal_order_id; recurring uses paypal_sale_id.
--
-- EXPAND-SAFE. Every statement is additive or a widening (drop NOT NULL, loosen
--   CHECK). The currently-deployed build keeps working: existing rows keep both
--   Stripe values and existing INSERTs still supply them. Migration + Vercel
--   build deploy concurrently with no ordering gate, so this matters. Contract
--   (dropping stripe_* columns) is a LATER PR once no code reads them.

-- ── subscriptions ───────────────────────────────────────────────────────────
alter table public.subscriptions
  add column if not exists provider text not null default 'stripe'
    check (provider in ('stripe','paypal')),
  add column if not exists provider_subscription_id text,
  add column if not exists provider_customer_id text;

update public.subscriptions
   set provider_subscription_id = stripe_subscription_id,
       provider_customer_id     = stripe_customer_id
 where provider_subscription_id is null;

-- provider-scoped replacement for the 23505 race backstop.
create unique index if not exists uq_subscriptions_provider_ref
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- widening (a PayPal row has neither Stripe id).
alter table public.subscriptions
  alter column stripe_subscription_id drop not null,
  alter column stripe_customer_id     drop not null;

-- ── subscription_plans ──────────────────────────────────────────────────────
alter table public.subscription_plans
  add column if not exists paypal_plan_id text;

create unique index if not exists uq_subscription_plans_paypal_plan_id
  on public.subscription_plans (paypal_plan_id)
  where paypal_plan_id is not null;

-- ── payments ────────────────────────────────────────────────────────────────
alter table public.payments
  add column if not exists paypal_sale_id text;

create unique index if not exists uq_payments_paypal_sale_id
  on public.payments (paypal_sale_id) where paypal_sale_id is not null;

-- Widen the cross-field CHECK. Real constraint name verified against the live
-- schema: payments_provider_id_check (the spec's payments_provider_ref_check was
-- indicative). Drop + re-add in one migration so no window exists with no
-- constraint.
alter table public.payments drop constraint if exists payments_provider_id_check;
alter table public.payments add constraint payments_provider_id_check check (
  (provider = 'stripe' and stripe_payment_intent is not null)
  or (provider = 'paypal' and (paypal_order_id is not null or paypal_sale_id is not null))
  or (provider = 'manual')
);

-- 20260616000000_subscription_billing_foundation.sql
--
-- Spec 018 — Subscription Billing Foundation (Phase 2, BLOCKING).
-- Establishes the recurring-billing rails: four new tables + RLS + a
-- financial/identity guard + an atomic idempotent grant function, all in one
-- migration (constitution / AGENTS.md §3: RLS ships in the same migration as
-- the tables). Amounts in integer cents, USD only. Reuses the existing
-- `student_packages` debit kernel + `payments` table.
--
-- Lands after the baseline (20260428000000) and every prior forward migration.
-- Never `db push` the baseline; this is a forward-only timestamped migration.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: RLS on every table, SECURITY DEFINER lockdown, service-role writes.
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  monthly credit grants are additive & idempotent (never reset a learner).

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum
      ('incomplete','active','past_due','canceled','incomplete_expired','unpaid');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'billing_plan_type') then
    create type public.billing_plan_type as enum
      ('recurring_monthly','recurring_limited');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'billing_event_status') then
    create type public.billing_event_status as enum
      ('received','processed','ignored','failed');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: subscription_plans (catalog mirror — binding source of what a cycle grants)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null unique,
  name text not null,
  plan_type public.billing_plan_type not null,
  monthly_credit_count integer not null check (monthly_credit_count >= 0),
  session_metadata jsonb not null default '{}'::jsonb,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  stripe_product_id text not null,
  stripe_price_id text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscription_plans is
  'Catalog mirror of Stripe subscription prices; binding source of per-cycle grant size (spec 018).';

-- Index for active-catalog lookups by code (RLS predicate col / hot read path).
create index if not exists subscription_plans_active_code_idx
  on public.subscription_plans (plan_code) where is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: stripe_customers (1:1 user ↔ Stripe customer)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stripe_customers is
  '1:1 mapping of platform user → Stripe customer id (spec 018 FR-002). Dual UNIQUE = race backstop (research R6).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: subscriptions (lifecycle mirror)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  payer_user_id uuid references public.profiles(id),
  plan_id uuid not null references public.subscription_plans(id),
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  status public.subscription_status not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_at timestamptz not null default 'epoch',
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Local mirror of Stripe subscription lifecycle. Stripe is source of truth; recency-guarded against out-of-order delivery (research R5).';

-- RLS predicate columns (50k-scale: btree on student_id; partial status for ops).
create index if not exists subscriptions_student_id_idx on public.subscriptions (student_id);
create index if not exists subscriptions_status_idx
  on public.subscriptions (status) where status in ('active','past_due');

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: billing_events (idempotency ledger / audit)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_event_created timestamptz not null,
  subscription_id uuid references public.subscriptions(id),
  stripe_customer_id text,
  status public.billing_event_status not null default 'received',
  error_detail text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.billing_events is
  'Append-only idempotency ledger + audit trail for Stripe webhook events. stripe_event_id is the idempotency key (FR-004).';

-- (stripe_event_id uniqueness is enforced by the column UNIQUE constraint above.)
create index if not exists billing_events_subscription_id_idx on public.billing_events (subscription_id);
create index if not exists billing_events_event_type_idx on public.billing_events (event_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse the existing public.set_updated_at())
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists t_subscription_plans_upd on public.subscription_plans;
create trigger t_subscription_plans_upd
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

drop trigger if exists t_stripe_customers_upd on public.stripe_customers;
create trigger t_stripe_customers_upd
  before update on public.stripe_customers
  for each row execute function public.set_updated_at();

drop trigger if exists t_subscriptions_upd on public.subscriptions;
create trigger t_subscriptions_upd
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- (billing_events is append-only → no updated_at trigger.)

-- ─────────────────────────────────────────────────────────────────────────────
-- student_packages: grant linkage columns (reused debit kernel)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.student_packages
  add column if not exists subscription_id uuid references public.subscriptions(id);

alter table public.student_packages
  add column if not exists billing_cycle_key text;

-- DEVIATION (documented): data-model.md says "student_packages reused unchanged",
-- but `package_id` is NOT NULL w/ FK→packages. A subscription-driven grant has no
-- `packages` row (subscriptions live in subscription_plans, a different table), so
-- the grant function cannot satisfy NOT NULL. Dropping NOT NULL is the only way to
-- honor the grant contract; the FK + existing a-la-carte grants (which always set
-- package_id) are unaffected. See final report.
alter table public.student_packages
  alter column package_id drop not null;

-- Per-cycle grant-once guarantee (FR-005 / R3). Partial unique index so legacy
-- a-la-carte grants (billing_cycle_key NULL) remain unrestricted.
create unique index if not exists student_packages_billing_cycle_key_key
  on public.student_packages (billing_cycle_key)
  where billing_cycle_key is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — enabled + policies in the SAME migration (AGENTS.md §3)
-- ─────────────────────────────────────────────────────────────────────────────

-- subscription_plans: public catalog (anon + authenticated read active plans only).
alter table public.subscription_plans enable row level security;
drop policy if exists "subscription_plans_read" on public.subscription_plans;
create policy "subscription_plans_read"
  on public.subscription_plans for select
  to anon, authenticated
  using (is_active);
-- No INSERT/UPDATE/DELETE policies → only service_role (bypasses RLS) can write.

-- stripe_customers: authenticated read own row.
alter table public.stripe_customers enable row level security;
drop policy if exists "stripe_customers_read_own" on public.stripe_customers;
create policy "stripe_customers_read_own"
  on public.stripe_customers for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- subscriptions: authenticated read where student OR payer OR admin.
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_read_own_or_admin" on public.subscriptions;
create policy "subscriptions_read_own_or_admin"
  on public.subscriptions for select
  to authenticated
  using (
    (select auth.uid()) = student_id
    or (select auth.uid()) = payer_user_id
    or private.is_admin()
  );

-- billing_events: admin-only.
alter table public.billing_events enable row level security;
drop policy if exists "billing_events_read_admin" on public.billing_events;
create policy "billing_events_read_admin"
  on public.billing_events for select
  to authenticated
  using (private.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE UPDATE guard on subscriptions (FR-007)
-- Mirrors private.guard_booking_identity_change(): lock identity + financial
-- columns against client mutation; exempt service_role, direct-DB (NULL JWT),
-- and admin. SECURITY DEFINER so is_admin() runs elevated and isn't self-blocked.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.guard_subscription_identity_change()
returns trigger
language plpgsql
security definer
set search_path TO 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if (new.student_id is distinct from old.student_id
      or new.payer_user_id is distinct from old.payer_user_id
      or new.plan_id is distinct from old.plan_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_customer_id is distinct from old.stripe_customer_id)
     and v_jwt_role is not null            -- NULL => direct DB / migration, trusted
     and v_jwt_role <> 'service_role'      -- trusted server actions
     and not private.is_admin()            -- admin via own session
  then
    raise exception 'only an admin may change subscription identity or financial fields'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.guard_subscription_identity_change() owner to postgres;

drop trigger if exists t_guard_subscription_identity_change on public.subscriptions;
create trigger t_guard_subscription_identity_change
  before update of student_id, payer_user_id, plan_id, stripe_subscription_id, stripe_customer_id
  on public.subscriptions
  for each row
  execute function private.guard_subscription_identity_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- grant_subscription_cycle(...) — atomic, idempotent payment + credit grant.
-- Contracts/grant-function.contract.md. SECURITY DEFINER, search_path=public.
-- The ONLY path that writes a subscription-driven student_packages grant.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.grant_subscription_cycle(
  p_subscription_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_cycle_key text,
  p_stripe_payment_intent text,
  p_amount_cents int,
  p_credit_count int,
  p_expires_at timestamptz,
  p_session_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_amount_usd   numeric := p_amount_cents / 100.0;
  v_payment_id   uuid;
  v_grant_id     uuid;
begin
  -- 1. Idempotency short-circuit: same cycle_key already granted → return it.
  select id into v_existing_id
    from public.student_packages
    where billing_cycle_key = p_cycle_key;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- 2. Payment (idempotent on stripe_payment_intent). Satisfies payments CHECK
  --    amount_usd = amount_before_tax + tax_amount (tax captured elsewhere/zero).
  insert into public.payments (
    student_id, provider, stripe_payment_intent,
    amount_usd, amount_before_tax, tax_rate, tax_amount, revenue_recognized,
    status, paid_at
  )
  values (
    p_student_id, 'stripe', p_stripe_payment_intent,
    v_amount_usd, v_amount_usd, 0, 0, 0,
    'succeeded', now()
  )
  on conflict (stripe_payment_intent) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select id into v_payment_id
      from public.payments
      where stripe_payment_intent = p_stripe_payment_intent;
  end if;

  -- 3. Grant. package_id is intentionally NULL (subscription grants carry
  --    subscription_id + billing_cycle_key, not a packages row). ON CONFLICT
  --    on the partial unique index is the race backstop for concurrent dup
  --    delivery (the billing_events insert upstream normally dedupes first).
  insert into public.student_packages (
    student_id, package_id, sessions_total, status,
    expires_at, session_mode_used, subscription_id, billing_cycle_key
  )
  values (
    p_student_id, null, p_credit_count, 'active',
    p_expires_at, p_session_metadata, p_subscription_id, p_cycle_key
  )
  on conflict (billing_cycle_key) where billing_cycle_key is not null do nothing
  returning id into v_grant_id;

  if v_grant_id is null then
    -- Lost the race; return the winner's id.
    select id into v_grant_id
      from public.student_packages
      where billing_cycle_key = p_cycle_key;
  end if;

  return v_grant_id;
end;
$$;

alter function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) owner to postgres;

-- Lockdown (NFR-002): only service_role may invoke. Never public/anon/authenticated.
revoke all on function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) to service_role;

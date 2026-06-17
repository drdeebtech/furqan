-- 20260617000000_catalog_credit_redesign.sql
--
-- Spec 019 — Product Catalog + Credit/Package Redesign (Phase 2).
--
-- Extends spec-018 billing rails with the hifz product catalog, single-active-hifz
-- enforcement, guardian/child relationships, family discounts, and pending tier
-- changes. All adjustable financial values are data (platform_settings / catalog
-- rows), never hardcoded (NFR-001).
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: RLS on every new table (same migration), BEFORE UPDATE guards,
--                   partial unique index for concurrent single-active-hifz safety.
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  tier terms captured at grant time; additive grants; discounts auditable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Add 'guardian' to user_role enum (needed for guardian APIs)
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
                 where t.typname = 'user_role' and e.enumlabel = 'guardian') then
    alter type public.user_role add value 'guardian' after 'admin';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER subscription_plans — add hifz catalog columns
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.subscription_plans
  add column if not exists is_hifz_product boolean not null default false,
  add column if not exists sessions_per_month integer,        -- hifz tiers only; NULL otherwise
  add column if not exists session_duration_min integer;      -- minutes per session; 60 for all current tiers

-- Hifz plans must have both session columns; non-hifz plans must have neither.
alter table public.subscription_plans
  add constraint if not exists chk_subscription_plans_hifz_fields
  check (
    (not is_hifz_product)
    or (
      sessions_per_month is not null
      and sessions_per_month > 0
      and session_duration_min is not null
      and session_duration_min > 0
    )
  );

comment on column public.subscription_plans.is_hifz_product is
  'True for the six hifz tiers; drives the single-active-hifz partial unique index on subscriptions (spec 019).';
comment on column public.subscription_plans.sessions_per_month is
  'Monthly credit count for hifz tiers (equals monthly_credit_count, named explicitly for catalog clarity).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALTER packages — widen package_type CHECK, add catalog columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop UNIQUE constraint on package_type: the new catalog model has multiple
-- rows sharing a package_type, distinguished by product_category. Legacy
-- a-la-carte packs remain unaffected (they still have unique types; the
-- constraint is simply no longer enforced).
alter table public.packages drop constraint if exists packages_package_type_key;

-- Widen CHECK: add exactly ONE new value 'tajweed_course' (spec clarification).
alter table public.packages drop constraint if exists packages_package_type_check;
alter table public.packages add constraint packages_package_type_check
  check (package_type = any (array[
    'single_session', 'pack_4', 'pack_8', 'pack_12', 'full_course',
    'tajweed_course'
  ]));

alter table public.packages
  add column if not exists subscription_plan_id uuid references public.subscription_plans(id),
  add column if not exists is_hifz_product boolean not null default false,
  add column if not exists product_category text
    check (product_category in ('hifz_group', 'hifz_individual', 'tajweed_mutoon', 'other'));

-- Each subscription plan maps to at most one package (catalog resolution is unambiguous).
create unique index if not exists uix_packages_subscription_plan_id
  on public.packages (subscription_plan_id)
  where subscription_plan_id is not null;

comment on column public.packages.subscription_plan_id is
  'FK to subscription_plans for recurring hifz tiers (spec 019); NULL for one-time / legacy packages.';
comment on column public.packages.product_category is
  'Catalog discriminator: hifz_group, hifz_individual, tajweed_mutoon, or other (spec 019).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ALTER student_packages — composite idempotency index
--    (subscription_id + billing_cycle_key columns already exist from spec 018)
-- ─────────────────────────────────────────────────────────────────────────────

-- Allow subscription-based grants to insert without a package_id (grant_hifz_cycle_credits
-- passes NULL when crediting via subscription rather than a specific package purchase).
alter table public.student_packages alter column package_id drop not null;

-- The spec-018 single-column unique index (student_packages_billing_cycle_key_key)
-- is retained for grant_subscription_cycle. This composite index supports the
-- spec-019 grant_hifz_cycle_credits function's ON CONFLICT target.
create unique index if not exists uix_student_packages_cycle_grant
  on public.student_packages (subscription_id, billing_cycle_key)
  where billing_cycle_key is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ALTER subscriptions — add is_hifz (for partial unique index) + pending_tier_change_id
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists is_hifz boolean not null default false;

comment on column public.subscriptions.is_hifz is
  'Denormalized from subscription_plans.is_hifz_product at create time; drives the single-active-hifz partial unique index (spec 019 R-001).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CREATE pending_tier_changes (before adding the reverse FK to subscriptions)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.pending_tier_changes (
  id                     uuid primary key default gen_random_uuid(),
  subscription_id        uuid not null references public.subscriptions(id),
  student_id             uuid not null references public.profiles(id),
  from_package_id        uuid not null references public.packages(id),
  to_package_id          uuid not null references public.packages(id),
  change_reason          text not null check (change_reason in ('type_change', 'teacher_change', 'downgrade', 'other')),
  requested_at           timestamptz not null default now(),
  applies_at_period_end  boolean not null default true,
  status                 text not null default 'pending'
    check (status in ('pending', 'applied', 'cancelled')),
  applied_at             timestamptz,
  created_at             timestamptz not null default now()
);

comment on table public.pending_tier_changes is
  'Records a tier change deferred to next renewal (type/teacher change or downgrade). At most one pending per subscription (partial unique index).';

-- Partial UNIQUE index: one pending change per subscription.
create unique index if not exists idx_pending_changes_subscription
  on public.pending_tier_changes (subscription_id)
  where status = 'pending';

-- Composite unique index enables the ownership-enforcing FK below.
-- id is already the PK (unique), so (id, subscription_id) is trivially unique.
create unique index if not exists uix_pending_tier_changes_id_subscription
  on public.pending_tier_changes (id, subscription_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5a. Add reverse FK: subscriptions.pending_tier_change_id → pending_tier_changes(id, subscription_id)
--     The composite FK enforces that the referenced row belongs to THIS subscription
--     (subscriptions.id must equal pending_tier_changes.subscription_id).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists pending_tier_change_id uuid;

alter table public.subscriptions
  add constraint fk_subscriptions_pending_tier_change
  foreign key (pending_tier_change_id, id)
  references public.pending_tier_changes (id, subscription_id)
  not valid;

alter table public.subscriptions validate constraint fk_subscriptions_pending_tier_change;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5b. Partial unique index — single active hifz per student (R-001)
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists uix_subscriptions_one_active_hifz
  on public.subscriptions (student_id)
  where is_hifz = true
    and status not in ('canceled', 'incomplete_expired');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CREATE guardian_children
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.guardian_children (
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  child_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (guardian_id, child_id),
  check (guardian_id <> child_id)
);

comment on table public.guardian_children is
  'Guardian↔child relationship: one guardian manages multiple children''s subscriptions (spec 019 FR-013).';

create index if not exists idx_guardian_children_child on public.guardian_children (child_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. CREATE subscription_discount_records (immutable audit ledger)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.subscription_discount_records (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  discount_type   text not null check (discount_type in ('second_individual', 'sibling_group')),
  discount_pct    numeric(5,2) not null check (discount_pct > 0 and discount_pct <= 100),
  setting_key     text not null,   -- platform_settings key used (audit trail)
  applied_at      timestamptz not null default now()
);

comment on table public.subscription_discount_records is
  'Immutable audit record of which discount was applied at subscription creation (spec 019 FR-015).';

create index if not exists idx_discount_records_subscription
  on public.subscription_discount_records (subscription_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — enabled + policies in the SAME migration (AGENTS.md §3 / NFR-002)
-- ─────────────────────────────────────────────────────────────────────────────

-- guardian_children: guardian reads own rows; student reads own child row; admin reads all.
alter table public.guardian_children enable row level security;

drop policy if exists "guardian_children_read" on public.guardian_children;
create policy "guardian_children_read"
  on public.guardian_children for select
  to authenticated
  using (
    (select auth.uid()) = guardian_id
    or (select auth.uid()) = child_id
    or private.is_admin()
  );

-- No INSERT/UPDATE/DELETE policies → only service_role (bypasses RLS) can write.

-- subscription_discount_records: guardian reads own children's; admin reads all.
alter table public.subscription_discount_records enable row level security;

drop policy if exists "discount_records_read" on public.subscription_discount_records;
create policy "discount_records_read"
  on public.subscription_discount_records for select
  to authenticated
  using (
    (select auth.uid()) in (
      select s.student_id from public.subscriptions s where s.id = subscription_id
    )
    or (select auth.uid()) in (
      select gc.guardian_id
      from public.guardian_children gc
      join public.subscriptions s on s.student_id = gc.child_id
      where s.id = subscription_id
    )
    or private.is_admin()
  );

-- No INSERT/UPDATE/DELETE policies → only service_role can write (immutable ledger).

-- pending_tier_changes: student reads own; admin reads all.
alter table public.pending_tier_changes enable row level security;

drop policy if exists "pending_tier_changes_read" on public.pending_tier_changes;
create policy "pending_tier_changes_read"
  on public.pending_tier_changes for select
  to authenticated
  using (
    (select auth.uid()) = student_id
    or private.is_admin()
  );

-- No INSERT/UPDATE/DELETE policies → only service_role can write.

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. BEFORE UPDATE guards (NFR-003 — protect financial/identity columns)
-- ─────────────────────────────────────────────────────────────────────────────

-- 9a. Extend the existing subscription identity guard to include is_hifz.
--     Service-role is exempt (renewal flow re-keys the tier legitimately).
create or replace function private.guard_subscription_identity_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if (new.student_id is distinct from old.student_id
      or new.payer_user_id is distinct from old.payer_user_id
      or new.plan_id is distinct from old.plan_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.is_hifz is distinct from old.is_hifz)
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
  before update of student_id, payer_user_id, plan_id, stripe_subscription_id, stripe_customer_id, is_hifz
  on public.subscriptions
  for each row
  execute function private.guard_subscription_identity_change();

-- 9b. pending_tier_changes identity columns — immutable once created.
create or replace function private.guard_pending_tier_change_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if (new.subscription_id is distinct from old.subscription_id
      or new.student_id is distinct from old.student_id
      or new.from_package_id is distinct from old.from_package_id
      or new.to_package_id is distinct from old.to_package_id
      or new.change_reason is distinct from old.change_reason)
     and v_jwt_role is not null
     and v_jwt_role <> 'service_role'
     and not private.is_admin()
  then
    raise exception 'pending_tier_changes identity columns are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.guard_pending_tier_change_identity() owner to postgres;

drop trigger if exists t_guard_pending_tier_change_identity on public.pending_tier_changes;
create trigger t_guard_pending_tier_change_identity
  before update of subscription_id, student_id, from_package_id, to_package_id, change_reason
  on public.pending_tier_changes
  for each row
  execute function private.guard_pending_tier_change_identity();

-- 9c. subscription_discount_records — fully immutable (write-once ledger).
-- Blocks all JWT-authenticated mutations (including service_role REST calls).
-- Direct Postgres connections (migrations, maintenance scripts) have no JWT claims
-- and are the only authorised path for administrative corrections.
create or replace function private.guard_discount_record_immutable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_jwt_role is not null then
    raise exception 'subscription_discount_records are immutable'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function private.guard_discount_record_immutable() owner to postgres;

drop trigger if exists t_guard_discount_record_immutable on public.subscription_discount_records;
create trigger t_guard_discount_record_immutable
  before update on public.subscription_discount_records
  for each row
  execute function private.guard_discount_record_immutable();

drop trigger if exists t_guard_discount_record_immutable_delete on public.subscription_discount_records;
create trigger t_guard_discount_record_immutable_delete
  before delete on public.subscription_discount_records
  for each row
  execute function private.guard_discount_record_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SEED: six hifz tiers into subscription_plans
-- ─────────────────────────────────────────────────────────────────────────────

-- Placeholder Stripe IDs: local-only. Production sets these from the Stripe
-- dashboard or CLI before going live. The stripe_price_id UNIQUE constraint
-- is satisfied by distinct placeholder values.
insert into public.subscription_plans (
  plan_code, name, plan_type, monthly_credit_count, session_metadata,
  price_cents, currency, stripe_product_id, stripe_price_id,
  is_active, is_hifz_product, sessions_per_month, session_duration_min
) values
  ('hifz_group_4',      'Hifz Group — 4 sessions/month',  'recurring_monthly', 4,
    '{"mode": "group", "duration_min": 60}'::jsonb,
    1200, 'usd', 'prod_hifz_group_4_local', 'price_hifz_group_4_local',
    true, true, 4, 60),
  ('hifz_group_6',      'Hifz Group — 6 sessions/month',  'recurring_monthly', 6,
    '{"mode": "group", "duration_min": 60}'::jsonb,
    1500, 'usd', 'prod_hifz_group_6_local', 'price_hifz_group_6_local',
    true, true, 6, 60),
  ('hifz_group_8',      'Hifz Group — 8 sessions/month',  'recurring_monthly', 8,
    '{"mode": "group", "duration_min": 60}'::jsonb,
    2000, 'usd', 'prod_hifz_group_8_local', 'price_hifz_group_8_local',
    true, true, 8, 60),
  ('hifz_individual_4h', 'Hifz Individual — 4 hours/month', 'recurring_monthly', 4,
    '{"mode": "individual", "duration_min": 60}'::jsonb,
    4000, 'usd', 'prod_hifz_individual_4h_local', 'price_hifz_individual_4h_local',
    true, true, 4, 60),
  ('hifz_individual_6h', 'Hifz Individual — 6 hours/month', 'recurring_monthly', 6,
    '{"mode": "individual", "duration_min": 60}'::jsonb,
    6000, 'usd', 'prod_hifz_individual_6h_local', 'price_hifz_individual_6h_local',
    true, true, 6, 60),
  ('hifz_individual_8h', 'Hifz Individual — 8 hours/month', 'recurring_monthly', 8,
    '{"mode": "individual", "duration_min": 60}'::jsonb,
    8000, 'usd', 'prod_hifz_individual_8h_local', 'price_hifz_individual_8h_local',
    true, true, 8, 60)
on conflict (plan_code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. SEED: six hifz tiers into packages (mirrors, for catalog browse)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.packages (
  package_type, name, name_ar, session_count, duration_min, price_usd,
  is_active, display_order, subscription_plan_id, is_hifz_product, product_category,
  supports_session_modes
)
select
  'full_course',
  sp.name,
  case
    when sp.plan_code like 'hifz_group_%' then
      case sp.sessions_per_month
        when 4 then 'حفظ جماعي ٤ حصص'
        when 6 then 'حفظ جماعي ٦ حصص'
        when 8 then 'حفظ جماعي ٨ حصص'
        else sp.name
      end
    when sp.plan_code like 'hifz_individual_%' then
      case sp.sessions_per_month
        when 4 then 'حفظ فردي ٤ ساعات'
        when 6 then 'حفظ فردي ٦ ساعات'
        when 8 then 'حفظ فردي ٨ ساعات'
        else sp.name
      end
    else sp.name
  end,
  sp.sessions_per_month,
  sp.session_duration_min,
  sp.price_cents / 100.0,
  true,
  case
    when sp.plan_code like 'hifz_group_%' then
      case sp.sessions_per_month when 4 then 1 when 6 then 2 when 8 then 3 else 9 end
    when sp.plan_code like 'hifz_individual_%' then
      case sp.sessions_per_month when 4 then 4 when 6 then 5 when 8 then 6 else 9 end
    else 9 end,
  sp.id,
  true,
  case when sp.plan_code like 'hifz_group_%' then 'hifz_group'
       when sp.plan_code like 'hifz_individual_%' then 'hifz_individual'
       else 'other' end,
  case when sp.plan_code like 'hifz_group_%' then array['halaqa']
       else array['private'] end
from public.subscription_plans sp
where sp.is_hifz_product = true
  and not exists (
    select 1 from public.packages p where p.subscription_plan_id = sp.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. SEED: platform_settings keys (all adjustable financial values)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.platform_settings (key, value) values
  ('hifz_individual_hourly_rate_usd',     '10.00'),
  ('hifz_group_4_price_usd',              '12.00'),
  ('hifz_group_6_price_usd',              '15.00'),
  ('hifz_group_8_price_usd',              '20.00'),
  ('hifz_second_individual_discount_pct', '10'),
  ('hifz_sibling_group_discount_pct',     '10'),
  ('hifz_assessment_price_usd',           '0.00'),
  ('hifz_assessment_limit_per_specialty', '1')
on conflict (key) do nothing;

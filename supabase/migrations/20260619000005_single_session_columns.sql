-- 20260619000005_single_session_columns.sql
-- (renamed from 20260619000001 → 20260619000005 to resolve a schema_migrations
--  version collision with spec 021's 20260619000001_subscription_extensions.sql,
--  already merged to main and owning that timestamp. Applies after 021's
--  attendance/payroll block — no cross-dependency — and before 022's own
--  20260619000010/000011 fixes that depend on this file.)
--
-- Spec 022 (م٥): Onboarding assessment + per-session-paid single sessions.
--
-- Adds four identity columns to `bookings` so a one-time-paid single session
-- (assessment / instant / specialized) is distinguishable from a legacy
-- credit-funded booking, plus its specialty / purpose / target_scope payload.
-- Adds the atomic SECURITY DEFINER creator `create_single_session_booking`
-- (booking + session + payment link in ONE transaction) so the
-- payment_intent.succeeded webhook NEVER does a bare INSERT — partial
-- booking-without-session cannot persist.
--
-- Also adapts `start_instant_session_booking` with an optional p_payment_id
-- parameter: when set, the booking is funded by a one-time Stripe payment
-- (student_package_id = NULL, payments.booking_id linked) instead of debiting
-- a student_packages credit. Backward-compatible: p_payment_id = NULL keeps
-- the original package-debit path.
--
-- Constitution compliance (AGENTS.md §2/§3):
--   • RLS: no new standalone table; new columns inherit existing bookings RLS.
--   • BEFORE UPDATE OF guard uses the canonical service-role bypass idiom
--     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
--     (matches 20260613140000_guard_booking_identity_change.sql). NULL/empty
--     JWT = trusted direct-DB/migration write → bypass. Never
--     current_setting('role') (wrong GUC, exemption never matches).
--   • SECURITY DEFINER functions: EXECUTE granted to service_role ONLY.
--   • No student_packages debit: p_payment_id path stamps NULL.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Specialized-purpose enum
-- ────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type specialized_purpose as enum (
    'review',
    'consolidate_surah',
    'memorize_mutoon',
    'test_juz_mutashabihat'
  );
exception when duplicate_object then null; end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. bookings: product type + assessment specialty + specialized payload
-- ────────────────────────────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists booking_product_type text
    check (booking_product_type in ('assessment','instant','specialized','subscription')),
  add column if not exists specialty text,
  add column if not exists purpose specialized_purpose,
  add column if not exists target_scope jsonb;

comment on column public.bookings.booking_product_type is
  'Spec 022: distinguishes one-time-paid single sessions (assessment/instant/specialized) from subscription-funded ones. NULL = legacy credit-funded rows (pre-022); reporting must treat NULL as legacy.';
comment on column public.bookings.specialty     is 'Spec 022: specialty requested for an assessment booking (e.g. hifz, tajweed).';
comment on column public.bookings.purpose       is 'Spec 022: specialized-session purpose enum.';
comment on column public.bookings.target_scope  is 'Spec 022: specialized-session target scope (jsonb: {surah:36} / {juz:30} / {mutoon:"..."} / {mutashabihat:"..."}).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. BEFORE UPDATE OF identity guard (canonical service-role bypass idiom)
-- ────────────────────────────────────────────────────────────────────────────
-- Lives in `private` (not exposed via REST RPC) like the existing
-- private.guard_booking_identity_change(). Mirrors its canonical
-- nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
-- bypass idiom: NULL/empty JWT = trusted direct-DB / migration write; service_role
-- and admin are exempt. A student cannot rewrite product_type / specialty /
-- purpose / target_scope on an existing booking.
create or replace function private.bookings_single_session_identity_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  -- NULL/empty JWT claims = trusted direct-DB / migration write → bypass.
  -- service_role = trusted server action → bypass.
  if v_jwt_role is null or v_jwt_role = 'service_role' then
    return new;
  end if;
  if private.is_admin() then
    return new;
  end if;
  if new.booking_product_type is distinct from old.booking_product_type then
    raise exception 'booking_product_type is immutable after creation'
      using errcode = '42501';
  end if;
  if new.specialty is distinct from old.specialty then
    raise exception 'specialty is immutable after creation'
      using errcode = '42501';
  end if;
  if new.purpose is distinct from old.purpose then
    raise exception 'purpose is immutable after creation'
      using errcode = '42501';
  end if;
  if new.target_scope is distinct from old.target_scope then
    raise exception 'target_scope is immutable after creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.bookings_single_session_identity_guard() owner to postgres;

drop trigger if exists bookings_single_session_identity_guard_trigger on public.bookings;
create trigger bookings_single_session_identity_guard_trigger
  before update of booking_product_type, specialty, purpose, target_scope on public.bookings
  for each row
  execute function private.bookings_single_session_identity_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Atomic creator: create_single_session_booking
-- ────────────────────────────────────────────────────────────────────────────
-- The ONLY creation path for assessment / specialized bookings. Called by:
--   • payment_intent.succeeded webhook (paid path) with a real p_payment_id
--   • zero-price checkout route with p_payment_id = NULL (fail-before-charge
--     gate already validated specialist + limit before this call)
-- Booking + session + payment link are one transaction; partial
-- booking-without-session cannot persist. Idempotency at the caller via
-- billing_events UNIQUE idempotency_key `pi_{payment_intent_id}` (a retried
-- event re-invokes this fn at most once).
--
-- Sessions are created UNSCHEDULED (scheduled_at NULL); choosing the slot is
-- a separate follow-up step (surfaced in GET /my-bookings as scheduledAt=null).
--
-- Signature note: required params precede defaulted ones (PG 42P13).
create or replace function public.create_single_session_booking(
  p_student_id           uuid,
  p_teacher_id           uuid,
  p_booking_product_type text,
  p_payment_id           uuid default null,
  p_specialty            text default null,
  p_purpose              specialized_purpose default null,
  p_target_scope         jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking_id uuid;
  v_session_id uuid;
begin
  -- Validate product type at the kernel (defense in depth; route already
  -- zod-validates). assessment/specialized flow through this creator only.
  if p_booking_product_type not in ('assessment','specialized') then
    raise exception 'invalid booking_product_type for single-session creator: %',
      p_booking_product_type using errcode = 'P0001';
  end if;

  -- Booking. student_package_id is ALWAYS NULL — these products are one-time
  -- paid, never credit-funded (NFR-001 / FR-007).
  insert into public.bookings (
    student_id, teacher_id, student_package_id,
    booking_product_type, specialty, purpose, target_scope,
    session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount,
    scheduled_at, status, teacher_confirmed
  ) values (
    p_student_id, p_teacher_id, null,
    p_booking_product_type, p_specialty, p_purpose, p_target_scope,
    'hifz', 30, 0, 0, 0, 0,
    null, 'pending', false
  )
  returning id into v_booking_id;

  -- Unscheduled session row (scheduled_at NULL = pending slot selection).
  insert into public.sessions (booking_id, student_id, teacher_id, scheduled_at)
    values (v_booking_id, p_student_id, p_teacher_id, null)
    returning id into v_session_id;

  update public.bookings set session_id = v_session_id where id = v_booking_id;

  -- Link the payment (no-op when p_payment_id is NULL — zero-price path).
  if p_payment_id is not null then
    update public.payments set booking_id = v_booking_id where id = p_payment_id;
  end if;

  return v_booking_id;
end;
$$;

alter function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) owner to postgres;

-- EXECUTE lockdown (NFR-002): revoke from public/anon/authenticated; grant
-- to service_role ONLY. Supabase ALTER DEFAULT PRIVILEGES otherwise grants
-- EXECUTE on new public functions to anon + authenticated.
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from public;
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from anon;
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from authenticated;
grant execute on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Adapt start_instant_session_booking with optional p_payment_id
-- ────────────────────────────────────────────────────────────────────────────
-- When p_payment_id is non-null: this is a one-time-paid instant session
-- (spec 022). student_package_id is NULL and the payment is linked to the
-- booking via payments.booking_id. The original package-debit path is
-- preserved verbatim when p_payment_id is null (backward-compat).
create or replace function public.start_instant_session_booking(
  p_student_id    uuid,
  p_teacher_id    uuid,
  p_session_type  public.session_type,
  p_duration_min  integer,
  p_rate_snapshot numeric,
  p_amount_usd    numeric,
  p_scheduled_at  timestamp with time zone,
  p_payment_id    uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_pkg        uuid;
  v_booking_id uuid;
begin
  if p_payment_id is not null then
    -- ── One-time-paid path (spec 022) ────────────────────────────────────
    -- Funded by Stripe payment, not a package debit. student_package_id
    -- stays NULL. Atomic: booking insert + payment link in one txn.
    insert into public.bookings (
      student_id, teacher_id, session_type, duration_min, rate_snapshot,
      amount_usd, scheduled_at, status, teacher_confirmed, teacher_confirmed_at,
      student_package_id, booking_product_type
    ) values (
      p_student_id, p_teacher_id, p_session_type, p_duration_min, p_rate_snapshot,
      p_amount_usd, p_scheduled_at, 'confirmed', true, p_scheduled_at,
      null, 'instant'
    )
    returning id into v_booking_id;

    -- CodeRabbit #11/#? : verify the payment link matched an UNLINKED row.
    -- `and booking_id is null` prevents reassigning a payment that is already
    -- linked to another booking (integrity corruption); the not-found branch
    -- then covers both nonexistent and already-linked p_payment_id. The whole
    -- function is one txn, so raising rolls back the booking insert too.
    update public.payments set booking_id = v_booking_id
      where id = p_payment_id and booking_id is null;
    if not found then
      raise exception 'p_payment_id % not found or already linked — instant booking % rejected',
        p_payment_id, v_booking_id using errcode = 'P0002';
    end if;

    return v_booking_id;
  end if;

  -- ── Original package-debit path (unchanged) ────────────────────────────
  -- Soonest-expiry active package with credit, locked. Same predicate/order
  -- as the deduct_student_package trigger. SKIP LOCKED prevents two concurrent
  -- instant sessions from racing onto the same package row.
  select id into v_pkg
  from public.student_packages
  where student_id = p_student_id
    and status = 'active'
    and sessions_used < sessions_total
    and (expires_at is null or expires_at > now())
  order by expires_at asc nulls last, purchased_at asc
  limit 1
  for update skip locked;

  if v_pkg is null then
    raise exception 'no_active_package'
      using errcode = 'P0001',
            detail = 'no active package with remaining credit for student ' || p_student_id;
  end if;

  if not public.deduct_package_session(v_pkg) then
    raise exception 'package_debit_failed'
      using errcode = 'P0001',
            detail = 'deduct_package_session returned false for package ' || v_pkg;
  end if;

  insert into public.bookings (
    student_id, teacher_id, session_type, duration_min, rate_snapshot,
    amount_usd, scheduled_at, status, teacher_confirmed, teacher_confirmed_at,
    student_package_id, booking_product_type
  ) values (
    p_student_id, p_teacher_id, p_session_type, p_duration_min, p_rate_snapshot,
    p_amount_usd, p_scheduled_at, 'confirmed', true, p_scheduled_at, v_pkg, 'instant'
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

alter function public.start_instant_session_booking(
  uuid, uuid, public.session_type, integer, numeric, numeric, timestamp with time zone, uuid
) owner to postgres;

-- Re-lockdown under the new signature (8-arg). Drop the old 7-arg grants too.
revoke all on function public.start_instant_session_booking(
  uuid, uuid, public.session_type, integer, numeric, numeric, timestamp with time zone, uuid
) from public;
revoke all on function public.start_instant_session_booking(
  uuid, uuid, public.session_type, integer, numeric, numeric, timestamp with time zone, uuid
) from anon;
revoke all on function public.start_instant_session_booking(
  uuid, uuid, public.session_type, integer, numeric, numeric, timestamp with time zone, uuid
) from authenticated;
grant execute on function public.start_instant_session_booking(
  uuid, uuid, public.session_type, integer, numeric, numeric, timestamp with time zone, uuid
) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Seed single-session price settings (admin sets real values later)
-- ────────────────────────────────────────────────────────────────────────────
-- All seeded to '0.00' (free-by-default until an admin configures a price).
-- ON CONFLICT DO NOTHING so re-running this migration never overwrites an
-- admin's set values.
insert into public.platform_settings (key, value, description) values
  ('single_session_instant_price_usd',          '0.00', 'Spec 022: one-time Stripe price (USD) for an instant session.'),
  ('single_session_assessment_price_usd',       '0.00', 'Spec 022: one-time Stripe price (USD) for an assessment session. 0 = free.'),
  ('single_session_review_price_usd',           '0.00', 'Spec 022: one-time Stripe price (USD) for a review (مراجعة) session.'),
  ('single_session_consolidate_surah_price_usd','0.00', 'Spec 022: one-time Stripe price (USD) for a consolidate-surah session.'),
  ('single_session_memorize_mutoon_price_usd',  '0.00', 'Spec 022: one-time Stripe price (USD) for a memorize-mutoon session.'),
  ('single_session_test_juz_price_usd',         '0.00', 'Spec 022: one-time Stripe price (USD) for a test-juz/mutashabihat session.')
on conflict (key) do nothing;

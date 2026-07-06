-- 20260715000000_prepaid_hour_wallet_schema.sql
--
-- Spec 038 — Prepaid Hour Wallet, Phase 1 (data model + settings).
-- Design authority: spec.md → "Eng-review resolutions (2026-07-06)" R1–R10, H1–H5.
-- This migration is the ENTIRE Phase 1 scope: schema + catalog row + settings seeds.
-- No SECURITY DEFINER money functions (grant/draw/restore/refund/sweep are Phase 2),
-- no app/TypeScript code, no edits to database.ts / supabase.generated.ts.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: every new column is nullable/defaulted (expand-safe); RLS on the
--                   new table ships in THIS migration (§3 / NFR-002); append-only
--                   ledger is enforced by a BEFORE UPDATE/DELETE trigger that ALWAYS
--                   raises — RLS alone is insufficient because service_role bypasses
--                   it (H5).
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  rate, expiry, preset sizes are data (platform_settings), not code.
--
-- Expand/contract (AGENTS.md §4):
--   - All column additions are ADD COLUMN ... nullable OR NOT NULL with a DEFAULT
--     (back-fills existing rows atomically; no table rewrite).
--   - The packages.package_type CHECK is WIDENED to admit one new value
--     'prepaid_hours'. Widening a CHECK is expand-safe: every existing row still
--     satisfies the looser constraint, and the old build never inserts the new
--     value. The constraint is dropped+recreated (the repo pattern from
--     20260617000000); scripts/check-migration-safety.sh does not flag
--     DROP CONSTRAINT (only DROP COLUMN/TABLE), and the change is genuinely
--     additive in semantics.
--   - No DROP COLUMN, RENAME, type narrowing, SET NOT NULL, or DROP DEFAULT.
--   - Therefore safe under concurrent migration + Vercel deploy with no ordering
--     gate (R10).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Widen packages.package_type CHECK to admit 'prepaid_hours' (R1 catalog row)
-- ─────────────────────────────────────────────────────────────────────────────
-- The catalog discriminator column on `packages` is named `package_type` (real
-- column, NOT `product_type` as the spec loosely calls it — R4's "packages.product_type"
-- is a logical reference, not the physical column). We reuse the existing column
-- and widen its CHECK. The new packages row is seeded in section 2 below.

alter table public.packages drop constraint if exists packages_package_type_check;
alter table public.packages
  add constraint packages_package_type_check
  check (package_type = any (array[
    'single_session', 'pack_4', 'pack_8', 'pack_12', 'full_course',
    'tajweed_course', 'prepaid_hours'
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed ONE packages catalog row for the prepaid-hours wallet (R1 / T1.1)
-- ─────────────────────────────────────────────────────────────────────────────
-- One immutable catalog row; every wallet purchase creates a NEW student_packages
-- lot row pointing at THIS row (R1: "one immutable lot per purchase, never top up
-- an existing row"). session_count=1 because the lot's sessions_total = hours
-- purchased (R1: "Hours map to sessions_total"); the catalog row's session_count
-- is the unit-of-sale (one hour), not the bundle size.
--
-- Fixed uuid so Phase 2+ (grant_prepaid_hours) can reference it without a lookup:
--   'c0ffee01-0000-4000-8000-000000038000'
-- Mnemonic: 038 = spec number. Stable across dev/staging/prod as long as the
-- migration runs; the ON CONFLICT DO NOTHING guard makes re-runs safe.
--
-- Columns set are exactly those that exist on `packages` (verified against the
-- v8 baseline + 20260617000000). price_usd=10 matches the seeded
-- prepaid_hours_rate_usd setting (D3 / FR-012); a wallet hour is a $10 60-min
-- session (R7). duration_min=60 locks the R7 "60-min 1:1 only" precondition at
-- the catalog level. supports_session_modes={private} — wallet hours are
-- individual-only (D2 / R7); group halaqat stay subscription-only.

insert into public.packages (
  id, package_type, name, name_ar, description, description_ar,
  session_count, duration_min, price_usd,
  is_active, is_featured, display_order,
  is_hifz_product, product_category, supports_session_modes
) values (
  'c0ffee01-0000-4000-8000-000000038000',
  'prepaid_hours',
  'Prepaid Hour Wallet',
  'محفظة ساعات الدفع المسبق',
  'Pay-as-you-go 60-minute individual session hour. Buy a bundle, book when you can.',
  'ساعة فردية مدتها ٦٠ دقيقة بنظام الدفع عند الحاجة. اشترِ حزمة واحجز وقتما تشاء.',
  1,
  60,
  10.00,
  true,
  false,
  100,
  false,
  'hifz_individual',
  array['private']
)
on conflict (id) do nothing;

comment on column public.packages.package_type is
  'Catalog discriminator. prepaid_hours = pay-as-you-go wallet unit (spec 038 R1); one seeded row, many student_packages lots reference it. Each lot is one purchase, never topped up (R1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. student_packages additive columns (R4 / R6 denormalized discriminator + lot fields)
-- ─────────────────────────────────────────────────────────────────────────────
-- R4: product_type is DENORMALIZED onto student_packages so selection and the
-- debit kernel stay join-free. Default 'subscription' covers every existing
-- (subscription + legacy a-la-carte) row atomically at ADD COLUMN time; new
-- wallet grants set 'prepaid_hours'. packages.package_type remains the catalog
-- source of truth — this mirror is just a read-path optimization.
--
-- R1: each lot carries its own rate_paid_usd (frozen at purchase) and
-- stripe_payment_intent_id (the H1 idempotency claim).
--
-- All three columns are nullable-or-defaulted → expand-safe (NFR-002, AGENTS.md §4).

alter table public.student_packages
  add column if not exists product_type text not null default 'subscription';

alter table public.student_packages
  add column if not exists rate_paid_usd numeric(10,2);

alter table public.student_packages
  add column if not exists stripe_payment_intent_id text;

comment on column public.student_packages.product_type is
  'Denormalized from packages.package_type at grant time (spec 038 R4). Default subscription covers all legacy/subscription lots; prepaid_hours marks a wallet lot. Selection (selectActivePackage) and the debit kernel read this without joining packages.';
comment on column public.student_packages.rate_paid_usd is
  'Per-hour rate FROZEN at purchase (spec 038 R1/R8). Refund amount = unused_hours × rate_paid_usd, never the current setting. NULL on legacy/subscription rows.';
comment on column public.student_packages.stripe_payment_intent_id is
  'Stripe PaymentIntent that funded this lot. UNIQUE partial index = the H1 idempotency claim (one lot per intent; webhook redelivery is a no-op). NULL on subscription/legacy rows.';

-- H1 idempotency: one student_packages lot per stripe_payment_intent_id. Partial
-- (WHERE NOT NULL) so the many subscription/legacy rows with NULL are unrestricted.
create unique index if not exists uix_student_packages_stripe_payment_intent
  on public.student_packages (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. New table: prepaid_hours_events (R5 append-only ledger)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every wallet money mutation (grant / draw / restore / expired / refunded)
-- appends exactly one row here via the Phase-2 record_prepaid_event(...) helper.
-- Students can SELECT only their own (join package_id → student_packages.student_id
-- = auth.uid()). Writes are service-role / SECURITY DEFINER only (Phase 2) — no
-- INSERT/UPDATE/DELETE policy for anon/authenticated here.
--
-- Append-only is enforced by a BEFORE UPDATE/DELETE trigger that ALWAYS raises
-- (H5) — service_role bypasses RLS, so RLS alone cannot make a ledger immutable.

create table if not exists public.prepaid_hours_events (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.student_packages(id) on delete restrict,
  event_type  text not null check (event_type in ('grant','draw','restore','expired','refunded')),
  hours_delta integer not null,
  stripe_ref  text,
  created_at  timestamptz not null default now(),
  check (hours_delta <> 0)
);

comment on table public.prepaid_hours_events is
  'Append-only ledger of every prepaid-hour wallet mutation (spec 038 R5). grant/draw/restore/expired/refunded. Immutable: enforced by BEFORE UPDATE/DELETE trigger (H5), not only RLS.';
comment on column public.prepaid_hours_events.package_id is
  'FK to the charged student_packages lot (R1 — one immutable lot per purchase).';
comment on column public.prepaid_hours_events.event_type is
  'grant = purchase; draw = booking consumed one hour; restore = teacher-no-show gave it back; expired = sweep voided a dormant lot; refunded = admin pro-rated refund voided hours.';
comment on column public.prepaid_hours_events.hours_delta is
  'Signed hour delta: +N for grant/restore, -N for draw/expired/refunded. CHECK <> 0 (a no-op event is never logged).';
comment on column public.prepaid_hours_events.stripe_ref is
  'Stripe reference for this event: payment_intent_id for grant, refund id for refunded, NULL for internal ops (draw/restore/expired).';

-- History + selection indexes (R9).
create index if not exists idx_prepaid_hours_events_package_created
  on public.prepaid_hours_events (package_id, created_at);

-- Causation uniqueness — only the singular one we can justify from current columns:
-- one grant EVENT per lot. (The lot-level grant idempotency is already enforced by
-- uix_student_packages_stripe_payment_intent above; this makes the ledger agree:
-- exactly one 'grant' row per package_id.) The draw/restore/refunded causation
-- keys require columns not yet on this table (booking_id, refund_request_id) and
-- are deferred to Phase 2 with the rest of the money-path design (R5 — table shape
-- ready, columns added when the constraints that need them land).
create unique index if not exists uix_prepaid_hours_events_one_grant_per_lot
  on public.prepaid_hours_events (package_id)
  where event_type = 'grant';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Append-only enforcement trigger (H5)
-- ─────────────────────────────────────────────────────────────────────────────
-- Raises unconditionally on UPDATE or DELETE. Unlike private.guard_discount_record_
-- immutable (which exempts direct-DB / migrations via the JWT-claim check), this
-- trigger must block EVERY writer including service_role: H5 is explicit that
-- RLS is insufficient because service_role bypasses it. A direct superuser
-- connection is the only escape hatch (consistent with the discount-records
-- precedent and reserved for documented administrative correction).

create or replace function private.guard_prepaid_hours_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'prepaid_hours_events is append-only: DELETE blocked (package_id=%, event_type=%)'
      using errcode = 'P0001', detail = old.event_type::text || ' on ' || old.package_id::text;
  else
    raise exception 'prepaid_hours_events is append-only: UPDATE blocked (package_id=%, event_type=%)'
      using errcode = 'P0001', detail = new.event_type::text || ' on ' || new.package_id::text;
  end if;
end;
$$;

alter function private.guard_prepaid_hours_event_immutable() owner to postgres;

drop trigger if exists trg_prepaid_hours_events_immutable_update on public.prepaid_hours_events;
create trigger trg_prepaid_hours_events_immutable_update
  before update on public.prepaid_hours_events
  for each row
  execute function private.guard_prepaid_hours_event_immutable();

drop trigger if exists trg_prepaid_hours_events_immutable_delete on public.prepaid_hours_events;
create trigger trg_prepaid_hours_events_immutable_delete
  before delete on public.prepaid_hours_events
  for each row
  execute function private.guard_prepaid_hours_event_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. RLS — enabled + SELECT-only policy in the SAME migration (§3 / NFR-002)
-- ─────────────────────────────────────────────────────────────────────────────
-- A student may SELECT only their own wallet events (join package_id →
-- student_packages.student_id = auth.uid()). Admins see all via private.is_admin().
-- No INSERT/UPDATE/DELETE policy for anon/authenticated — the trigger in 4a blocks
-- UPDATE/DELETE for everyone (incl. service_role), and writes are issued only by
-- the Phase-2 SECURITY DEFINER helpers (which bypass RLS as service_role).
alter table public.prepaid_hours_events enable row level security;

drop policy if exists prepaid_hours_events_select_own on public.prepaid_hours_events;
create policy prepaid_hours_events_select_own on public.prepaid_hours_events
  for select to authenticated
  using (
    exists (
      select 1 from public.student_packages sp
      where sp.id = prepaid_hours_events.package_id
        and sp.student_id = (select auth.uid())
    )
    or private.is_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Selection + sweep indexes (R9)
-- ─────────────────────────────────────────────────────────────────────────────
-- Partial indexes that match the live selection predicates (so the planner uses
-- them on the hot paths: selectActivePackage + the future prepaid sweep).

create index if not exists idx_student_packages_active_by_student_expiry
  on public.student_packages (student_id, expires_at)
  where status = 'active';

create index if not exists idx_student_packages_prepaid_active_expiry
  on public.student_packages (expires_at)
  where product_type = 'prepaid_hours' and status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Settings seeds (FR-012 / T1.6)
-- ─────────────────────────────────────────────────────────────────────────────
-- platform_settings(key, value) is the repo's admin-editable money-knob home
-- (seeded precedent: 20260617000000 — hifz_individual_hourly_rate_usd etc.).
-- All wallet tunables live here as DATA, never hardcoded (NFR-001).
--
-- Values:
--   prepaid_hours_rate_usd         = 10       (D3 flat $10/session-hour)
--   prepaid_hours_expiry_months    = 12       (D5 rolling window)
--   prepaid_hours_preset_sizes     = [5,10,20] (D3 presets)
--   prepaid_hours_custom_min       = 1        (custom qty lower bound)
--   prepaid_hours_custom_max       = 100      (custom qty upper bound)
--   prepaid_hours_reminder_lead_days = 14     (FR-010 pre-expiry n8n reminder)

insert into public.platform_settings (key, value, description) values
  ('prepaid_hours_rate_usd',           '10',     'Flat USD per wallet hour (spec 038 D3). Server computes price = hours × this; never trust client amount.'),
  ('prepaid_hours_expiry_months',      '12',     'Rolling expiry window in months (spec 038 D5). Wallet expires_at resets to now()+this on every purchase/draw.'),
  ('prepaid_hours_preset_sizes',       '[5,10,20]', 'Preset hour bundles shown on /pricing (spec 038 D3).'),
  ('prepaid_hours_custom_min',         '1',      'Minimum custom wallet hour quantity (spec 038 D3).'),
  ('prepaid_hours_custom_max',         '100',    'Maximum custom wallet hour quantity (spec 038 D3).'),
  ('prepaid_hours_reminder_lead_days', '14',     'Pre-expiry reminder lead time in days (spec 038 FR-010). n8n fires this many days before a lot''s expires_at.')
on conflict (key) do nothing;

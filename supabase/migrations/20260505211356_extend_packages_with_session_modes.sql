-- Stage 3 / Track A — Pricing scaffolding for session modes
--
-- Extends the existing packages + student_packages model so a single package
-- can grant a mix of private / halaqa / lecture sessions instead of a single
-- mode-agnostic count. NO new tables. NO UPDATE on existing rows.
--
-- Why extension rather than a new student_session_allowances table:
--   - The existing `student_packages` row + `deduct_package_session(uuid)`
--     SQL function are already the canonical "remaining sessions" source
--     of truth, used by booking, parent reports, dashboard widgets, etc.
--   - A parallel `student_session_allowances` table (as the migration plan
--     proposed) would have created dual sources of truth that drift the
--     moment any code path forgets to update one of them.
--   - Extending the existing shape keeps every consumer working unchanged
--     while enabling mode-aware accounting where it matters (Stage 5).
--
-- Decisions baked in (from the migration-plan critique):
--   1. Legacy packages with `session_count = N` continue to work.
--      `deduct_package_session_mode()` falls back to `session_count` when
--      the JSONB allowance is empty for the requested mode.
--   2. No Stripe wiring in this stage — pricing is just data here.
--   3. Bilingual labels in the UI (Stage 4 scope) come from constants,
--      not from the DB columns.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. packages — mode-aware allowances + future halaqa pricing tiers
-- ─────────────────────────────────────────────────────────────────────────

-- Per-mode session counts. Defaults to all-zero so existing code that
-- reads `session_count` keeps working unchanged. New halaqa-bundle
-- packages will set this; legacy private packages can stay at 0 here
-- and let the deduct fallback below handle them.
alter table packages
  add column if not exists session_mode_allowances jsonb not null
    default '{"private": 0, "halaqa": 0, "lecture": 0}'::jsonb;

-- Optional halaqa pricing-tier ladder for packages that include halaqa
-- access (e.g. capacity-based pricing: smaller halaqa = higher per-seat
-- price). Stage 5 will define the exact shape; for now we just reserve
-- the column.
alter table packages
  add column if not exists halaqa_pricing_tiers jsonb default '[]'::jsonb;

-- Which session modes a package supports. Defaults to {'private'} so
-- every legacy package keeps its current behavior. Stored as TEXT[] so
-- we can use the existing session_mode enum without forcing a new
-- domain-specific check constraint.
alter table packages
  add column if not exists supports_session_modes text[] not null default array['private'];

-- ─────────────────────────────────────────────────────────────────────────
-- 2. student_packages — per-mode usage tracking
-- ─────────────────────────────────────────────────────────────────────────
--
-- Mirrors session_mode_allowances on the parent package. The legacy
-- sessions_used / sessions_total columns continue to be the canonical
-- counter for private (and aggregate) usage; the JSONB here adds the
-- mode-level breakdown without creating a parallel table.

alter table student_packages
  add column if not exists session_mode_used jsonb not null
    default '{"private": 0, "halaqa": 0, "lecture": 0}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Atomic mode-aware deduction
-- ─────────────────────────────────────────────────────────────────────────
--
-- Companion to the existing `deduct_package_session(p_package_id uuid)`
-- which is mode-agnostic. Stage 5 booking flows for halaqa will call this
-- new variant with an explicit mode. Private booking continues to use the
-- legacy function until Stage 5 migrates it (intentional sequencing —
-- keeps the diff small and reversible).
--
-- Returns true if the deduction succeeded, false if no allowance left
-- for that mode. Race-safe via the WHERE clause atomic check.

create or replace function deduct_package_session_mode(
  p_package_id uuid,
  p_mode text
)
returns boolean
language sql
as $$
  with allowance as (
    select
      sp.id,
      -- Per-mode allowance lives on the package; fallback to session_count
      -- for legacy private when the JSONB is zero (preserves backwards compat
      -- for packages created before this migration).
      coalesce(
        nullif((p.session_mode_allowances->>p_mode)::int, 0),
        case when p_mode = 'private' then p.session_count else 0 end
      ) as mode_allowance,
      coalesce((sp.session_mode_used->>p_mode)::int, 0) as mode_used
    from student_packages sp
    join packages p on p.id = sp.package_id
    where sp.id = p_package_id
      and sp.status = 'active'
      and sp.sessions_used < sp.sessions_total
      and (sp.expires_at is null or sp.expires_at > now())
  )
  update student_packages
  set
    -- Bump the legacy aggregate (so existing dashboards keep working)
    sessions_used = sessions_used + 1,
    -- Bump the per-mode counter
    session_mode_used = jsonb_set(
      session_mode_used,
      array[p_mode],
      to_jsonb(coalesce((session_mode_used->>p_mode)::int, 0) + 1)
    )
  from allowance a
  where student_packages.id = a.id
    and a.mode_used < a.mode_allowance
  returning true;
$$;

comment on function deduct_package_session_mode(uuid, text) is
  'Atomic mode-aware decrement. Returns true if a session was deducted for the given mode, false if no allowance remains. Falls back to packages.session_count for legacy private packages whose session_mode_allowances JSONB is still zero. Stage 5 booking flow uses this; Stage 3 ships the function so Stage 5 has it ready.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Documentation
-- ─────────────────────────────────────────────────────────────────────────

comment on column packages.session_mode_allowances is
  'Per-mode session count: { "private": N, "halaqa": M, "lecture": K }. Defaults to all-zero. Legacy packages with session_count > 0 implicitly grant `private` via the fallback in deduct_package_session_mode().';

comment on column packages.halaqa_pricing_tiers is
  'Reserved for Stage 5 halaqa per-seat pricing ladder. Defaults to empty array.';

comment on column packages.supports_session_modes is
  'Which modes this package can be used to book. Defaults to {''private''} for backwards compat. Stage 5 admin package editor surfaces this as a multi-select.';

comment on column student_packages.session_mode_used is
  'Per-mode usage breakdown mirroring packages.session_mode_allowances. Aggregate sessions_used continues to be the canonical total counter.';

-- 20260619000010_spec022_fix_nullable_scheduled_at_and_amount_check.sql
--
-- Spec 022 follow-up. `create_single_session_booking` (20260619000001) was
-- authored against the spec design ("Sessions are created UNSCHEDULED
-- (scheduled_at NULL); choosing the slot is a separate follow-up step" and
-- "Zero-price = free (no Stripe)") but the bookings schema required
-- `scheduled_at NOT NULL` and enforced `CHECK (amount_usd > 0)`. Both
-- constraints reject every creator invocation at runtime:
--
--   • Bug A: null value in column "scheduled_at" violates not-null constraint
--   • Bug B: new row for relation "bookings" violates check constraint
--            "bookings_amount_usd_check"
--
-- Resolution decisions (with the architect, 2026-06-18):
--   • Bug A: make `scheduled_at` nullable. Assessment / specialized bookings
--     are created without a slot (slot chosen later). Existing instant /
--     subscription bookings continue to pass a real timestamp at creation.
--     Application consumers are updated to render NULL scheduled_at as
--     "Unscheduled" rather than silently degrade to Epoch.
--   • Bug B: relax the check to `amount_usd >= 0`. Zero-price assessment
--     bookings are part of the spec ("Zero-price = free (no Stripe)") and
--     must be persistable. Negative amounts remain invalid.
--
-- Constitution compliance (AGENTS.md §3): both changes are additive/relaxing
-- (no new table, no RLS weakening, no service-role expansion). Existing RLS
-- policies on `bookings` are unaffected. Idempotent.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. bookings.scheduled_at: NOT NULL → NULLABLE
-- ────────────────────────────────────────────────────────────────────────────
-- Existing rows all have non-null scheduled_at (the NOT NULL constraint
-- guaranteed it). Only future single-session assessment/specialized bookings
-- will use NULL. Application reads (dashboard, sessions list, session-status)
-- are updated to handle NULL gracefully in the same spec-022 follow-up commit.
alter table public.bookings
  alter column scheduled_at drop not null;

comment on column public.bookings.scheduled_at is
  'Scheduled start time. NULL for spec-022 single-session assessment/specialized bookings where the slot is chosen after creation (see create_single_session_booking). Non-null for instant / subscription bookings and any pre-022 row.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. bookings.amount_usd: relax CHECK (> 0) to (>= 0)
-- ────────────────────────────────────────────────────────────────────────────
-- Zero-price assessment bookings ("Zero-price = free (no Stripe)", spec 022
-- §US1) require amount_usd = 0 to be persistable. Negative amounts remain
-- invalid. Drop the strict check and re-add as >= 0.
alter table public.bookings
  drop constraint if exists bookings_amount_usd_check;

alter table public.bookings
  add constraint bookings_amount_usd_check check (amount_usd >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. no_booking_overlap: also exclude NULL scheduled_at rows
-- ────────────────────────────────────────────────────────────────────────────
-- Direct consequence of (1). The existing exclusion guard uses
-- tstzrange(scheduled_at, furqan_local_booking_end(scheduled_at, duration_min)).
-- When scheduled_at IS NULL the range collapses to '(,)' (empty/infinite) and
-- any two unscheduled bookings for the same teacher falsely "overlap" — so a
-- teacher with multiple pending assessment bookings (slot not yet chosen)
-- cannot coexist, defeating the spec 022 design.
--
-- An unscheduled booking cannot overlap anything by definition (it has no
-- time yet). Add `AND scheduled_at IS NOT NULL` to the predicate so the
-- guard continues to prevent double-booked *scheduled* slots while leaving
-- pending slot-less bookings free to coexist. Once a slot is chosen
-- (scheduled_at set), the constraint re-engages and prevents conflicts.
alter table public.bookings
  drop constraint if exists no_booking_overlap;

alter table public.bookings
  add constraint no_booking_overlap
  exclude using gist (
    teacher_id with =,
    tstzrange(scheduled_at, furqan_local_booking_end(scheduled_at, duration_min)) with &&
  ) where (status <> all (array['cancelled'::booking_status, 'no_show'::booking_status])
           and scheduled_at is not null);

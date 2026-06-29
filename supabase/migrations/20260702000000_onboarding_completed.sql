-- Issue #545 — student onboarding wizard.
--
-- Persist an explicit `onboarding_completed` flag on profiles so the
-- `/student/dashboard` guard can route brand-new students to the 3-step
-- onboarding wizard (teacher → plan → book) exactly once, and bypass it
-- for returning students. This replaces the previous activity-heuristic
-- ("no sessions, no bookings, no subscription") which can't distinguish
-- "finished onboarding, no sessions yet" from "brand new".
--
-- Existing rows backfill to `false` via the column default on ADD COLUMN
-- (matches the repo's idempotent add-column idiom, e.g. v15_007_full_name_ar).
--
-- RLS: no policy change required. The existing `profiles_update` policy
--   FOR UPDATE USING (is_admin() OR auth.uid() = id)
-- is NOT column-scoped — it already permits a user to update ANY column on
-- their own row, so `onboarding_completed` is covered automatically. The
-- server action that flips this flag updates via the authenticated session
-- client, which is exactly the identity RLS enforces. We do NOT weaken or
-- disable any existing policy.

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

comment on column public.profiles.onboarding_completed is
  'Issue #545 — true once the student has completed the 3-step onboarding wizard. '
  'Drives the /student/dashboard → /student/teachers?new=1 redirect guard. '
  'Defaults to false; flipped to true by the completeOnboarding server action '
  '(userId derived from the authenticated session, never from input).';

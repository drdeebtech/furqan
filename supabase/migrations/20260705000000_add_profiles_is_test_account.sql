-- spec 035 US1 (FR-001/FR-002): make the public teacher listing default-deny
-- against seed/E2E test accounts via a flag the public read can filter on.
--
-- Expand-only / backward-compatible: adds a NOT NULL column WITH a default, so
-- the currently-running build keeps working (old code ignores the new column).
-- No drop/rename/type-change → passes scripts/check-migration-safety.sh.
-- The new code that reads it (.eq is_test_account,false) degrades to an empty
-- list, not an error, in the brief window before this (seconds-long) apply
-- overtakes the minutes-long Vercel build.

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'True for seed/E2E/test-fixture accounts; excluded from all public listings (spec 035 US1). Set by /api/auth/test-login for future test users and by this one-time backfill.';

-- One-time bounded backfill. Migrations run with elevated rights and may read
-- auth.users (public.profiles has no email column). Matches only known test
-- rows; the `and is_test_account = false` keeps it a no-op on re-run.
update public.profiles p
set is_test_account = true
from auth.users u
where u.id = p.id
  and p.is_test_account = false
  and (
    u.email like '%@furqan.test'
    or p.full_name ilike '%(delete me)%'
    or p.full_name ilike '%test teacher%'
  );

-- All-surface demotion (T013): every teacher-listing surface (public /teachers,
-- the student teacher-picker, the teacher-detail page, specialist matching)
-- already filters `is_archived = false AND is_accepting = false-excluded AND
-- cv_status = 'approved'`. Archiving the test accounts' teacher_profiles makes
-- ALL of those existing gates exclude them at once — no per-surface code change.
-- Idempotent: only flips rows that are currently live.
update public.teacher_profiles tp
set is_archived = true,
    is_accepting = false
from public.profiles p
where tp.teacher_id = p.id
  and p.is_test_account = true
  and (tp.is_archived = false or tp.is_accepting = true);

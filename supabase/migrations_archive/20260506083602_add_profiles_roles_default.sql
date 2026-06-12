-- Add a default to public.profiles.roles so the auth trigger can insert.
--
-- Root cause of Sentry JAVASCRIPT-NEXTJS-E4-1T (Database error saving new user):
-- public.profiles has roles user_role[] NOT NULL with NO DEFAULT, but the
-- auth.users trigger function private.handle_new_user() only inserts
-- (id, full_name, avatar_url) — confirmed by the diagnostic dump in PR #96.
-- Every signup since the multi-role refactor has been hitting:
--   ERROR: null value in column "roles" of relation "profiles" violates not-null constraint
-- which Supabase Auth rolls back into HTTP 500 unexpected_failure.
--
-- The CHECK constraint profiles_active_role_in_set requires role = ANY (roles).
-- profiles.role already defaults to 'student'::user_role, so the matching
-- default for roles is ARRAY['student']::user_role[] — keeps the invariant
-- automatically for trigger-created rows.
--
-- This is the minimum-blast-radius fix: existing rows are untouched (they
-- already satisfy the NOT NULL because they couldn't have been inserted
-- otherwise), and any code path that explicitly sets roles continues to win.

alter table public.profiles
  alter column roles set default array['student']::user_role[];

-- v15_003: tighten RLS on platform_settings + teacher_profiles.
--
-- The RLS regression test suite (src/lib/supabase/rls.test.ts) caught two
-- wide-open SELECT policies on its first run:
--
-- 1. platform_settings used `anyone_read_settings USING (true)` — every
--    visitor with the public anon key could read feature flags + admin keys.
--    Fix: limit to authenticated users (admin app already reads via the
--    service-role admin client through getSettings(), so the public layout
--    is unaffected).
--
-- 2. teacher_profiles used `tp_select USING (true)` — anyone could query
--    pending/rejected/archived teachers. The public /teachers-page filters
--    in code, but RLS didn't enforce it. Fix: anon sees only approved,
--    accepting, non-archived teachers; authenticated still sees all
--    (student/admin/teacher dashboards depend on it).

-- ─── platform_settings ────────────────────────────────────────────────────
-- Two pre-existing wide-open SELECT policies needed dropping (the second one,
-- settings_select, was set up later with a different name and re-opened the
-- table even after anyone_read_settings was dropped). Both dropped here.
drop policy if exists "anyone_read_settings" on public.platform_settings;
drop policy if exists settings_select on public.platform_settings;
create policy "authenticated_read_settings"
  on public.platform_settings
  for select
  to authenticated
  using (true);

-- ─── teacher_profiles ─────────────────────────────────────────────────────
drop policy if exists tp_select on public.teacher_profiles;

-- Anonymous: only approved + accepting + non-archived teachers visible.
create policy "tp_select_anon_approved"
  on public.teacher_profiles
  for select
  to anon
  using (cv_status = 'approved' and is_archived = false and is_accepting = true);

-- Authenticated (students, teachers, moderators, admins): see all rows.
create policy "tp_select_authenticated"
  on public.teacher_profiles
  for select
  to authenticated
  using (true);

insert into schema_migrations (version, description)
  values ('v15_003', 'V15.3: tighten RLS — lock anon reads on platform_settings; restrict teacher_profiles anon reads to approved+accepting+!archived')
  on conflict do nothing;

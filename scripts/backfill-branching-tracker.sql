-- Backfill the Supabase Branching tracker (`supabase_migrations.schema_migrations`)
-- for timestamped migrations whose SQL is already applied to the production
-- DB but never registered with the integration.
--
-- Background:
--   The Supabase Branching GitHub integration applies migrations from
--   supabase/migrations/<ts>_<name>.sql by running the SQL and then inserting
--   a row into supabase_migrations.schema_migrations. As of 2026-05-02 the
--   integration is silently skipping applies on this account — five
--   timestamped files were committed across May 1 + May 2 but the tracker
--   has no rows for them. The schemas WERE applied (via the documented
--   hotfix path `npx supabase db query --linked --file …`, see the catchup
--   commit 59bc503 for May 1 + this same path for 20260502114946 today).
--
--   This script makes the tracker honest. Inserting just the `version`
--   tells Branching "this is done, don't re-run." Idempotent thanks to
--   `on conflict do nothing`.
--
-- Run manually (production write, not auto-applied):
--   npx supabase db query --linked --file scripts/backfill-branching-tracker.sql
--
-- After running, verify with:
--   npx supabase migration list --linked
--   (each version below should appear in BOTH the Local and Remote columns)

insert into supabase_migrations.schema_migrations (version, name) values
  ('20260501071453', 'paypal_payments'),
  ('20260501173121', 'multi_role_support'),
  ('20260501174844', 'group_sessions_phase1'),
  ('20260501175419', 'group_sessions_phase2_offerings'),
  ('20260502114946', 'courses_platform_ownership'),
  ('20260506134112', 'resources_teacher_visibility'),
  ('20260506140536', 'teacher_can_read_student_packages')
on conflict (version) do nothing;

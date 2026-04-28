-- One-off remediation: backfill public.schema_migrations.
--
-- Background:
--   The .github/workflows/migration-drift.yml job (job name
--   "schema_migrations vs repo files") compares src/lib/supabase/migrations/v*.sql
--   filenames against rows in public.schema_migrations and fails when any repo
--   version is missing from the ledger.
--
--   On commit f3b6160 (2026-04-27) the job failed because rows for v9_001 through
--   v14_007 are absent from the ledger even though those schemas ARE applied to
--   production. CLAUDE.md asserts the ledger is the source of truth for v* files,
--   so the ledger should be made to match reality.
--
-- Run manually (production write, not auto-applied):
--   npx supabase db query --linked --file scripts/backfill-schema-migrations-ledger.sql
--
-- Idempotent — safe to re-run thanks to `on conflict do nothing`.

insert into public.schema_migrations (version) values
  ('v9_001'),
  ('v10_001'),
  ('v10_002'),
  ('v11_001'),
  ('v12_001'),
  ('v13_001'),
  ('v13_002'),
  ('v14_001'),
  ('v14_002'),
  ('v14_003'),
  ('v14_004'),
  ('v14_005'),
  ('v14_006'),
  ('v14_007'),
  ('v14_008'),
  ('v14_009'),
  ('v15_001'),
  ('v15_002'),
  ('v15_003'),
  ('v15_004'),
  ('v15_006'),
  ('v15_007'),
  ('v15_008'),
  ('v16_001'),
  ('v16_002')
on conflict (version) do nothing;

-- Verify after running:
--   select version, applied_at from public.schema_migrations order by version;

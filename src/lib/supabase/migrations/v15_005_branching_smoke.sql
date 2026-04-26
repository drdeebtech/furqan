-- v15_005_branching_smoke.sql
--
-- One-off smoke test for the Supabase Branching GitHub integration.
-- This migration does NOT change schema. It only stamps schema_migrations
-- so we can confirm the auto-deploy round-trip works:
--   1. Open this as a PR.
--   2. Branching detects the new file under src/lib/supabase/migrations/.
--   3. On merge to main, Branching auto-applies it to production.
--   4. We verify by reading schema_migrations on prod afterwards.
--
-- Idempotent: 'on conflict do nothing' means re-runs are no-ops.

insert into schema_migrations (version, description)
  values ('v15_005', 'Smoke test: verify Branching auto-deploy round-trip')
  on conflict do nothing;

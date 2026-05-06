-- Ensure parent_reports.title column exists
--
-- Sentry JAVASCRIPT-NEXTJS-E4-1D / -1C surface PG 42703
--   "column parent_reports.title does not exist"
-- on every /teacher/dashboard load that triggers a parent-report
-- digest (3 distinct users, ~12 events in 23h).
--
-- The column was declared NOT NULL in v9_001_schema.sql, but the
-- legacy migration tracker (public.schema_migrations) and the
-- Supabase Branching integration drifted: prod runs without the
-- column. send-narrative.ts inserts {title: final.subject} → 42703 →
-- silent fail surfaces in Sentry, no parent_report row written.
--
-- Idempotent fix: ADD COLUMN IF NOT EXISTS as nullable. Existing
-- rows (if any) remain valid; new inserts get a real subject string.
-- Once prod has the column, downstream readers (admin parent-report
-- digest, teacher dashboard) will start displaying titles again.
--
-- We do NOT enforce NOT NULL here because the deployed schema may
-- have rows from before this migration; backfilling those would
-- require a guess. Future migration can promote to NOT NULL after a
-- backfill if desired.

alter table public.parent_reports
  add column if not exists title text;

comment on column public.parent_reports.title is
  'Short subject line for the parent report (e.g. "ملخص جلسة 2026-05-06"). Added via 20260506_ensure_parent_reports_title to recover from schema drift detected by Sentry E4-1D/-1C.';

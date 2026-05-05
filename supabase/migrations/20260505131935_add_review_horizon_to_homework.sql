-- Add review_horizon to homework_assignments so each assignment carries the
-- teacher's pedagogical intent at creation time (consolidate the very last
-- session, refresh an older topic, or no review intent — fresh material).
--
-- Default 'none' so existing rows don't need a backfill and the new column
-- is forward-compatible with code paths that don't yet set it.
--
-- The partial index covers the student-side dashboard query that groups
-- assignments into "From last session" and "Refresh older" buckets — only
-- the active (near | far) rows are read by that query, so a partial index
-- is much smaller than indexing the entire table.

alter table public.homework_assignments
  add column if not exists review_horizon text not null default 'none'
  constraint review_horizon_valid check (review_horizon in ('near','far','none'));

create index if not exists idx_homework_student_horizon
  on public.homework_assignments(student_id, review_horizon, status)
  where review_horizon in ('near','far');

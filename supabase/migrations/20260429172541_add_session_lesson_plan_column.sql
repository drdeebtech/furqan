-- 20260429172541_add_session_lesson_plan_column.sql
-- Phase 8 of the 15-feature build plan: real-time lesson-progress %.
--
-- Adds a JSONB column to `sessions` storing an in-class checkpoint list
-- the teacher can tick through. The dashboard's Online Classes widget
-- and the student session-detail page subscribe to changes via Supabase
-- Realtime and surface a live `⚡ N%` chip.
--
-- Schema:
--   { checkpoints: [{ id, label, completed_at? }],
--     last_updated_at: ISO timestamp }
--
-- Either column missing or empty checkpoints array means "no plan" — the
-- UI degrades to today's behavior (no progress chip, no checklist).

alter table public.sessions
  add column if not exists lesson_plan jsonb;

comment on column public.sessions.lesson_plan is
  'In-class checkpoint plan. JSONB: { checkpoints: [{id, label, completed_at?}], last_updated_at }. Drives the live progress chip in the student dashboard Online Classes widget and on /student/sessions/[id]. Optional — sessions without a plan render unchanged.';

-- Feature flag default
insert into public.platform_settings (key, value, description)
select 'lesson_plan_enabled', 'true', 'Enables in-session lesson-plan checkpoints + live progress widget'
where not exists (
  select 1 from public.platform_settings where key = 'lesson_plan_enabled'
);

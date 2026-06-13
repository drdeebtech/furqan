-- 20260429170055_add_lesson_progress_dashboard_flags.sql
-- Phase 2 of the 15-feature build plan: per-row Continue Watching actions.
--
-- Adds a flag the student can flip to hide an in-progress lesson from their
-- dashboard table without losing their watch position. The lesson stays in
-- /student/courses/[id]; only the dashboard "Continue Watching" widget
-- respects the flag.

alter table public.course_lesson_progress
  add column if not exists hidden_from_dashboard boolean not null default false;

comment on column public.course_lesson_progress.hidden_from_dashboard is
  'When true, the lesson is excluded from the student dashboard "Continue Watching" table. Used by the per-row "Hide from list" action. Lesson remains accessible from the course page.';

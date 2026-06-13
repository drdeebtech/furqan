-- 20260429170829_add_study_log_table.sql
-- Phase 4 of the 15-feature build plan: Time Tracker.
--
-- Adds a per-student log of self-study time (memorization, review, dhikr,
-- or generic manual entries). The dashboard's Report Analytics chart will
-- UNION these durations with `sessions.actual_duration` so a student who
-- studied for 2 hours offline shows non-zero time on days they didn't have
-- a live class.

create table if not exists public.study_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  kind text not null default 'solo' check (kind in ('solo', 'review', 'dhikr', 'manual')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_log_student_started_idx
  on public.study_log (student_id, started_at desc);

-- Touch updated_at on UPDATE
create trigger study_log_set_updated_at
  before update on public.study_log
  for each row execute function public.set_updated_at();

-- RLS: students see/manage their own rows; admins/moderators see all.
alter table public.study_log enable row level security;

create policy study_log_owner_select on public.study_log
  for select using (auth.uid() = student_id);
create policy study_log_owner_insert on public.study_log
  for insert with check (auth.uid() = student_id);
create policy study_log_owner_update on public.study_log
  for update using (auth.uid() = student_id);
create policy study_log_owner_delete on public.study_log
  for delete using (auth.uid() = student_id);

create policy study_log_staff_all on public.study_log
  for all using (public.is_admin_or_mod());

comment on table public.study_log is
  'Self-reported study time entries (Time Tracker). One row per study session, manual or stopwatch. Joined with sessions.actual_duration for the Report Analytics chart.';

comment on column public.study_log.kind is
  'solo = independent memorization/practice; review = revising prior material; dhikr = remembrance; manual = generic time entry retroactively logged.';

-- Feature flag default (idempotent: skip if a row with this key already exists)
insert into public.platform_settings (key, value, description)
select 'time_tracker_enabled', 'true', 'Enables the /student/time-tracker page and dashboard analytics integration'
where not exists (
  select 1 from public.platform_settings where key = 'time_tracker_enabled'
);

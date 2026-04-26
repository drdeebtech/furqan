-- v15_006_browseable_views.sql
--
-- Add denormalized read-only views that join in human-readable names from
-- the `profiles` table. The underlying schema stays normalized for
-- correctness and storage efficiency; these views exist purely to make
-- the Supabase Table Editor browseable so we can spot-check data without
-- writing JOINs every time.
--
-- All views use `WITH (security_invoker = true)` so they enforce the same
-- RLS policies as the underlying tables — anon users can't bypass row
-- security by reading through a view. This is critical: without
-- security_invoker, views run with the privileges of the view's owner
-- (postgres/supabase_admin) and would expose every row.
--
-- All views prefixed with `v_` so they sort together in the dashboard.

-- ─── v_teachers ─────────────────────────────────────────────────────────────
create or replace view public.v_teachers
with (security_invoker = true)
as
select
  tp.teacher_id,
  p.full_name,
  p.phone,
  tp.cv_status,
  tp.is_archived,
  tp.is_accepting,
  tp.hourly_rate,
  tp.rating_avg,
  tp.total_sessions,
  tp.specialties,
  tp.recitation_standards,
  tp.gender,
  tp.bio,
  tp.bio_en,
  tp.intro_video_url,
  tp.cv_reviewed_at,
  tp.created_at
from public.teacher_profiles tp
left join public.profiles p on p.id = tp.teacher_id;

comment on view public.v_teachers is
  'Browseable teacher list — joins teacher_profiles + profiles. Read-only.';

-- ─── v_bookings ─────────────────────────────────────────────────────────────
create or replace view public.v_bookings
with (security_invoker = true)
as
select
  b.id as booking_id,
  s.full_name as student_name,
  t.full_name as teacher_name,
  b.scheduled_at,
  b.duration_min,
  b.status,
  b.session_type,
  b.notes,
  b.student_id,
  b.teacher_id,
  b.student_package_id,
  b.created_at
from public.bookings b
left join public.profiles s on s.id = b.student_id
left join public.profiles t on t.id = b.teacher_id;

comment on view public.v_bookings is
  'Browseable bookings — student + teacher names alongside booking detail.';

-- ─── v_sessions ─────────────────────────────────────────────────────────────
create or replace view public.v_sessions
with (security_invoker = true)
as
select
  ses.id as session_id,
  s.full_name as student_name,
  t.full_name as teacher_name,
  ses.started_at,
  ses.ended_at,
  ses.actual_duration,
  ses.teacher_joined,
  ses.student_joined,
  ses.room_name,
  ses.room_url,
  ses.created_via,
  ses.is_observable,
  ses.booking_id,
  ses.created_at
from public.sessions ses
left join public.bookings b on b.id = ses.booking_id
left join public.profiles s on s.id = b.student_id
left join public.profiles t on t.id = b.teacher_id;

comment on view public.v_sessions is
  'Browseable sessions — derives student/teacher names through the booking.';

-- ─── v_homework ─────────────────────────────────────────────────────────────
create or replace view public.v_homework
with (security_invoker = true)
as
select
  h.id as homework_id,
  s.full_name as student_name,
  t.full_name as teacher_name,
  h.title,
  h.homework_type,
  h.status,
  h.due_date,
  h.surah_number,
  h.ayah_start,
  h.ayah_end,
  h.pages_count,
  h.teacher_notes,
  h.assigned_at,
  h.ready_at,
  h.completed_at,
  h.parent_assignment_id,
  h.student_id,
  h.teacher_id,
  h.booking_id,
  h.created_at
from public.homework_assignments h
left join public.profiles s on s.id = h.student_id
left join public.profiles t on t.id = h.teacher_id;

comment on view public.v_homework is
  'Browseable homework assignments — adds student/teacher names.';

-- ─── v_evaluations ──────────────────────────────────────────────────────────
create or replace view public.v_evaluations
with (security_invoker = true)
as
select
  ev.id as evaluation_id,
  s.full_name as student_name,
  t.full_name as teacher_name,
  ev.evaluation_type,
  ev.evaluation_date,
  ev.overall_score,
  ev.hifz_score,
  ev.tajweed_score,
  ev.fluency_score,
  ev.attendance_score,
  ev.strengths,
  ev.areas_for_improvement,
  ev.next_goals,
  ev.teacher_comments,
  ev.student_id,
  ev.teacher_id,
  ev.created_at
from public.session_evaluations ev
left join public.profiles s on s.id = ev.student_id
left join public.profiles t on t.id = ev.teacher_id;

comment on view public.v_evaluations is
  'Browseable session evaluations — student/teacher names + scores.';

-- ─── v_progress ─────────────────────────────────────────────────────────────
create or replace view public.v_progress
with (security_invoker = true)
as
select
  sp.id as progress_id,
  s.full_name as student_name,
  t.full_name as teacher_name,
  sp.progress_type,
  sp.surah_from,
  sp.ayah_from,
  sp.surah_to,
  sp.ayah_to,
  sp.pages_reviewed,
  sp.quality_rating,
  sp.level,
  sp.teacher_notes,
  sp.student_id,
  sp.teacher_id,
  sp.booking_id,
  sp.created_at
from public.student_progress sp
left join public.profiles s on s.id = sp.student_id
left join public.profiles t on t.id = sp.teacher_id;

comment on view public.v_progress is
  'Browseable student progress entries — adds student/teacher names.';

-- ─── v_student_packages ─────────────────────────────────────────────────────
create or replace view public.v_student_packages
with (security_invoker = true)
as
select
  sp.id as student_package_id,
  s.full_name as student_name,
  p.name_ar as package_name_ar,
  p.name as package_name_en,
  p.package_type,
  sp.sessions_total,
  sp.sessions_used,
  sp.sessions_remaining,
  sp.status,
  sp.expires_at,
  sp.purchased_at,
  sp.student_id,
  sp.package_id,
  sp.payment_id,
  sp.created_at
from public.student_packages sp
left join public.profiles s on s.id = sp.student_id
left join public.packages p on p.id = sp.package_id;

comment on view public.v_student_packages is
  'Browseable student packages — student name + package name + remaining count.';

-- ─── Done. Stamp schema_migrations. ─────────────────────────────────────────

insert into schema_migrations (version, description)
  values ('v15_006', 'Browseable v_* views: teachers/bookings/sessions/homework/evaluations/progress/packages')
  on conflict do nothing;

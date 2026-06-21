-- 20260621000001_teacher_student_booking_stats.sql
--
-- Per-student booking aggregates for the teacher "My Students" page
-- (audit follow-up). Replaces an app-side query that capped at 500 rows and
-- silently undercounted stats for high-volume teachers.
--
-- Aggregates server-side and keys on auth.uid() (NOT a teacher-id parameter),
-- so a teacher can only ever read their own students even though the function
-- is SECURITY DEFINER. Granted to authenticated (the page calls it with the
-- user's session client) and service_role.

create or replace function public.teacher_student_booking_stats()
returns table (
  student_id   uuid,
  total        bigint,
  this_month   bigint,
  last_session timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.student_id,
    count(*)                                                              as total,
    count(*) filter (where b.scheduled_at >= date_trunc('month', now()))  as this_month,
    max(b.scheduled_at)                                                   as last_session
  from public.bookings b
  where b.teacher_id = auth.uid()
    and b.status in ('confirmed', 'completed')
  group by b.student_id;
$$;

revoke all on function public.teacher_student_booking_stats() from public;
grant execute on function public.teacher_student_booking_stats() to authenticated, service_role;

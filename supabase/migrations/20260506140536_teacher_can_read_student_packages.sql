-- 20260506140536_teacher_can_read_student_packages.sql
-- Description: let teachers SELECT student_packages for students they have
-- a booking history with — required for the new "Sessions remaining" column
-- on /teacher/students and any future package-balance UI a teacher needs
-- before lesson planning.
--
-- Strategy:
--   - SECURITY DEFINER helper `private.teacher_has_booked_student(teacher,
--     student)` returns true iff at least one row exists in `bookings` for
--     that pair. SECURITY DEFINER lets the helper bypass RLS on bookings
--     (otherwise the policy on student_packages would recurse into a
--     bookings policy that may itself reference auth.uid()).
--   - Additive RLS policy `student_packages_teacher_read` invokes the
--     helper. Existing student-facing and admin policies are untouched.
--   - EXECUTE grant to authenticated per the project's pattern (see
--     feedback_pg_security_definer_trigger_grants memory: revoking from
--     PUBLIC is not enough; named role must explicitly receive EXECUTE).

create or replace function private.teacher_has_booked_student(
  p_teacher uuid,
  p_student uuid
) returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select exists (
    select 1 from public.bookings
    where teacher_id = p_teacher
      and student_id = p_student
  );
$$;

revoke execute on function private.teacher_has_booked_student(uuid, uuid)
  from public;
grant execute on function private.teacher_has_booked_student(uuid, uuid)
  to authenticated;

drop policy if exists student_packages_teacher_read
  on public.student_packages;
create policy student_packages_teacher_read
  on public.student_packages
  for select
  to authenticated
  using (
    private.teacher_has_booked_student(auth.uid(), student_id)
  );

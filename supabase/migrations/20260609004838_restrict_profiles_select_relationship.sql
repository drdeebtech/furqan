-- 20260609004838_restrict_profiles_select_relationship.sql
-- Description: Replace the over-broad `profiles` SELECT RLS policy
-- (`USING (true)` — every authenticated user could read every user's PII:
-- phone, country, date_of_birth, and guardian parent_name/parent_phone/
-- parent_email/whatsapp via direct PostgREST) with a RELATIONSHIP-SCOPED
-- policy. Security audit finding HIGH-1.
--
-- New rule — a `profiles` row is SELECT-able by the per-request (RLS) client
-- only when the caller is:
--   * the row owner (id = auth.uid()), OR
--   * an admin (private.is_admin()), OR
--   * a teacher<->student COUNTERPARTY of the row, established via a `bookings`
--     row (either direction) OR a course enrollment
--     (course_enrollments -> courses.teacher_id, either direction).
--
-- Halaqa/group-session relationships already manifest as `bookings` rows, so
-- they are covered by the bookings branch.
--
-- Non-PII identity (name/avatar) needed for non-counterparty UI (e.g. course-
-- review author names) is served by the new `public_profiles` view, which
-- exposes ONLY id/full_name/avatar_url/role — never PII.
--
-- The service-role admin client bypasses RLS and is unaffected.

-- ---------------------------------------------------------------------------
-- 1. Composite indexes the relationship predicate needs at 50k scale.
--    Without these the per-row EXISTS(bookings ...) checks would seq-scan.
--    Both directions are indexed because the predicate matches teacher->student
--    and student->teacher.
-- ---------------------------------------------------------------------------
create index if not exists idx_bookings_teacher_student
  on public.bookings (teacher_id, student_id);
create index if not exists idx_bookings_student_teacher
  on public.bookings (student_id, teacher_id);

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER visibility helper.
--    Runs as the function owner so it reads bookings/courses/course_enrollments
--    WITHOUT applying their RLS — this both avoids any policy recursion and
--    keeps the predicate a simple indexed lookup. STABLE so the planner can
--    cache it per distinct id within a statement.
-- ---------------------------------------------------------------------------
create or replace function private.profile_is_visible(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- self
    p_target = (select auth.uid())
    -- admin sees everyone
    or (select private.is_admin())
    -- teacher <-> student via a booking (either direction)
    or exists (
      select 1
      from public.bookings b
      where (b.teacher_id = (select auth.uid()) and b.student_id = p_target)
         or (b.student_id = (select auth.uid()) and b.teacher_id = p_target)
    )
    -- teacher <-> student via a course enrollment (either direction)
    or exists (
      select 1
      from public.course_enrollments ce
      join public.courses c on c.id = ce.course_id
      where (c.teacher_id = (select auth.uid()) and ce.student_id = p_target)
         or (ce.student_id = (select auth.uid()) and c.teacher_id = p_target)
    );
$$;

comment on function private.profile_is_visible(uuid) is
  'RLS helper for profiles SELECT: true when the target row is the caller, the caller is admin, or the two share a teacher<->student relationship (bookings or course enrollment). SECURITY DEFINER to read the relationship tables without their RLS. See audit HIGH-1.';

-- Least privilege: only the roles that evaluate the policy may execute it.
revoke execute on function private.profile_is_visible(uuid) from public;
grant execute on function private.profile_is_visible(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Swap the SELECT policy. (UPDATE/INSERT policies are untouched.)
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using ( private.profile_is_visible(id) );

-- ---------------------------------------------------------------------------
-- 4. Name-only view for non-counterparty identity displays.
--    A plain (security definer / security_invoker = off) view, so it bypasses
--    the base-table RLS but surfaces ONLY non-PII identity columns. Granted to
--    authenticated only — NOT anon (no new public enumeration surface).
-- ---------------------------------------------------------------------------
create or replace view public.public_profiles as
  select id, full_name, full_name_ar, avatar_url, role
  from public.profiles;

comment on view public.public_profiles is
  'Non-PII identity projection of profiles (id, full_name, full_name_ar, avatar_url, role) for displaying names/avatars of users the caller is not a teacher<->student counterparty of. Carries no phone/parent/dob/whatsapp/country. See audit HIGH-1.';

grant select on public.public_profiles to authenticated, service_role;

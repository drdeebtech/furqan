-- Restrict course creation to admin/moderator roles only.
--
-- Previously the courses_insert policy allowed both
--   (a) admins to insert any row
--   (b) teachers to insert their own draft rows (teacher_id = auth.uid()).
-- Per product decision, recorded courses are now created by staff on behalf
-- of teachers — the teacher selects content but doesn't operate the
-- create-course flow. Tightening the WITH CHECK to admin OR moderator
-- enforces this at the DB level so even a leaked teacher session can't
-- bypass the admin-only UI.
--
-- Update + delete policies stay as-is: teachers still need to draft/edit
-- the content of courses assigned to them while in pending_review/rejected
-- state. Only the act of *creating* a course is admin-gated now.

drop policy if exists courses_insert on public.courses;

create policy courses_insert on public.courses
  for insert
  to authenticated
  with check ((select private.is_admin_or_mod()));

-- Fix #795: getTeacherMurajaahHealth returns [] for every teacher.
--
-- student_review_schedule shipped with only srs__student_read
-- (student_id = auth.uid()) and srs__admin_all. A teacher — who owns the
-- student via student_progress.teacher_id — matched neither, so every teacher
-- read returned zero rows: the teacher murajaah-health widget was silently
-- dead, and the SM-2 "overdue reviews" metric on the session-prep card (#568)
-- could not be scoped to the teacher.
--
-- Fix: add a teacher-scoped SELECT policy that mirrors the ownership model
-- already used by progress_select / errors_select — a teacher may read a
-- schedule row ONLY when its progress row (progress_id) has
-- teacher_id = auth.uid(). No wider access: a teacher cannot see another
-- teacher's students; the student and admin policies are untouched.
--
-- Expand-safe: pure ADD POLICY (backward-compatible; no drop/rename/narrowing).
-- auth.uid() is wrapped in a scalar subselect (initplan) per the repo's RLS
-- performance convention; progress_id is already indexed
-- (idx_student_review_schedule_progress_id).

CREATE POLICY "srs__teacher_read" ON "public"."student_review_schedule"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."student_progress" sp
      WHERE sp."id" = "student_review_schedule"."progress_id"
        AND sp."teacher_id" = ( SELECT "auth"."uid"() )
    )
  );

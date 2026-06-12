-- 20260504205408_add_student_read_parent_reports.sql
-- Description: Lets a student read their own parent_reports rows. Without
-- this policy, the new student-facing "your parent received this report"
-- surface on /student/progress (item #7 of the deep pedagogical analysis at
-- Project Memory/furqan/Runs/2026-05-04-2313) cannot read the row at all
-- — only admin/mod and the original teacher had SELECT access. Read-only;
-- the existing admin_mod_reports and teacher_read_reports policies remain
-- untouched.

-- Idempotent: drop-then-create so the migration can re-run safely.
DROP POLICY IF EXISTS "student_read_reports" ON parent_reports;

CREATE POLICY "student_read_reports" ON parent_reports
  FOR SELECT USING (student_id = auth.uid());

-- Consolidate V17 feature RLS policies + apply Supabase plan-cache pattern.
--
-- The 8 V17 migrations (study_log, help_*, resources, modules, module_lessons,
-- quizzes, quiz_questions, quiz_attempts, forum_*) created policies in two
-- ways that the Supabase performance advisor flags:
--   1. multiple_permissive_policies — overlapping FOR ALL + per-action policies
--      cause every relevant policy to evaluate per row, multiplying RLS cost.
--   2. auth_rls_initplan — bare `auth.uid()` / `is_admin_or_mod()` calls
--      re-evaluate per row instead of being cached in the query plan.
--
-- This migration drops the offending policies on those 13 tables and replaces
-- them with consolidated per-action policies that wrap helper calls in
-- `(select ...)` so PG can cache the function result for the entire query.
-- Semantics are preserved exactly; only access-control performance changes.

-- ─── study_log: per-student data ────────────────────────────────────────────
drop policy if exists study_log_owner_select on public.study_log;
drop policy if exists study_log_owner_insert on public.study_log;
drop policy if exists study_log_owner_update on public.study_log;
drop policy if exists study_log_owner_delete on public.study_log;
drop policy if exists study_log_staff_all    on public.study_log;

create policy study_log_access on public.study_log
  for all to authenticated
  using ((select auth.uid()) = student_id or (select public.is_admin_or_mod()))
  with check ((select auth.uid()) = student_id or (select public.is_admin_or_mod()));

-- ─── help_articles: public read published, admin write ─────────────────────
drop policy if exists help_articles_admin_all   on public.help_articles;
drop policy if exists help_articles_public_read on public.help_articles;

create policy help_articles_select on public.help_articles
  for select
  using (is_published = true or (select public.is_admin()));

create policy help_articles_insert on public.help_articles
  for insert to authenticated
  with check ((select public.is_admin()));

create policy help_articles_update on public.help_articles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy help_articles_delete on public.help_articles
  for delete to authenticated
  using ((select public.is_admin()));

-- ─── help_categories: same pattern, always readable ────────────────────────
drop policy if exists help_categories_admin_all   on public.help_categories;
drop policy if exists help_categories_public_read on public.help_categories;

create policy help_categories_select on public.help_categories
  for select using (true);

create policy help_categories_insert on public.help_categories
  for insert to authenticated
  with check ((select public.is_admin()));

create policy help_categories_update on public.help_categories
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy help_categories_delete on public.help_categories
  for delete to authenticated
  using ((select public.is_admin()));

-- ─── resources: public read published, admin write ─────────────────────────
drop policy if exists resources_admin_all   on public.resources;
drop policy if exists resources_public_read on public.resources;

create policy resources_select on public.resources
  for select
  using (is_published = true or (select public.is_admin()));

create policy resources_insert on public.resources
  for insert to authenticated
  with check ((select public.is_admin()));

create policy resources_update on public.resources
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy resources_delete on public.resources
  for delete to authenticated
  using ((select public.is_admin()));

-- ─── modules: public read for published courses, owner/admin write ─────────
drop policy if exists modules_teacher_write on public.modules;
drop policy if exists modules_public_read   on public.modules;

create policy modules_select on public.modules
  for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = modules.course_id
        and (c.status = 'published' or c.teacher_id = (select auth.uid()))
    )
    or (select public.is_admin_or_mod())
  );

create policy modules_insert on public.modules
  for insert to authenticated
  with check (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = modules.course_id and c.teacher_id = (select auth.uid()))
  );

create policy modules_update on public.modules
  for update to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = modules.course_id and c.teacher_id = (select auth.uid()))
  )
  with check (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = modules.course_id and c.teacher_id = (select auth.uid()))
  );

create policy modules_delete on public.modules
  for delete to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = modules.course_id and c.teacher_id = (select auth.uid()))
  );

-- ─── module_lessons: same pattern via parent module's course ───────────────
drop policy if exists module_lessons_teacher_write on public.module_lessons;
drop policy if exists module_lessons_public_read   on public.module_lessons;

create policy module_lessons_select on public.module_lessons
  for select
  using (
    exists (
      select 1 from public.modules m join public.courses c on c.id = m.course_id
      where m.id = module_lessons.module_id
        and (c.status = 'published' or c.teacher_id = (select auth.uid()))
    )
    or (select public.is_admin_or_mod())
  );

create policy module_lessons_insert on public.module_lessons
  for insert to authenticated
  with check (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.modules m join public.courses c on c.id = m.course_id
      where m.id = module_lessons.module_id and c.teacher_id = (select auth.uid())
    )
  );

create policy module_lessons_update on public.module_lessons
  for update to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.modules m join public.courses c on c.id = m.course_id
      where m.id = module_lessons.module_id and c.teacher_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.modules m join public.courses c on c.id = m.course_id
      where m.id = module_lessons.module_id and c.teacher_id = (select auth.uid())
    )
  );

create policy module_lessons_delete on public.module_lessons
  for delete to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.modules m join public.courses c on c.id = m.course_id
      where m.id = module_lessons.module_id and c.teacher_id = (select auth.uid())
    )
  );

-- ─── quizzes: public read published, teacher/admin write ───────────────────
drop policy if exists quizzes_teacher_write on public.quizzes;
drop policy if exists quizzes_public_read   on public.quizzes;

create policy quizzes_select on public.quizzes
  for select
  using (
    (
      is_published = true
      and exists (select 1 from public.courses c where c.id = quizzes.course_id and c.status = 'published')
    )
    or exists (select 1 from public.courses c where c.id = quizzes.course_id and c.teacher_id = (select auth.uid()))
    or (select public.is_admin_or_mod())
  );

create policy quizzes_insert on public.quizzes
  for insert to authenticated
  with check (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = quizzes.course_id and c.teacher_id = (select auth.uid()))
  );

create policy quizzes_update on public.quizzes
  for update to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = quizzes.course_id and c.teacher_id = (select auth.uid()))
  )
  with check (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = quizzes.course_id and c.teacher_id = (select auth.uid()))
  );

create policy quizzes_delete on public.quizzes
  for delete to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (select 1 from public.courses c where c.id = quizzes.course_id and c.teacher_id = (select auth.uid()))
  );

-- ─── quiz_questions: visible only when parent quiz is published ────────────
drop policy if exists quiz_questions_teacher_write on public.quiz_questions;
drop policy if exists quiz_questions_public_read   on public.quiz_questions;

create policy quiz_questions_select on public.quiz_questions
  for select
  using (
    exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id
        and (
          (q.is_published = true and c.status = 'published')
          or c.teacher_id = (select auth.uid())
        )
    )
    or (select public.is_admin_or_mod())
  );

create policy quiz_questions_insert on public.quiz_questions
  for insert to authenticated
  with check (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.teacher_id = (select auth.uid())
    )
  );

create policy quiz_questions_update on public.quiz_questions
  for update to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.teacher_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.teacher_id = (select auth.uid())
    )
  );

create policy quiz_questions_delete on public.quiz_questions
  for delete to authenticated
  using (
    (select public.is_admin_or_mod())
    or exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_questions.quiz_id and c.teacher_id = (select auth.uid())
    )
  );

-- ─── quiz_attempts: owner + teacher read + admin all ───────────────────────
drop policy if exists quiz_attempts_admin       on public.quiz_attempts;
drop policy if exists quiz_attempts_owner       on public.quiz_attempts;
drop policy if exists quiz_attempts_teacher_read on public.quiz_attempts;

create policy quiz_attempts_select on public.quiz_attempts
  for select to authenticated
  using (
    (select auth.uid()) = student_id
    or (select public.is_admin_or_mod())
    or exists (
      select 1 from public.quizzes q join public.courses c on c.id = q.course_id
      where q.id = quiz_attempts.quiz_id and c.teacher_id = (select auth.uid())
    )
  );

create policy quiz_attempts_insert on public.quiz_attempts
  for insert to authenticated
  with check ((select auth.uid()) = student_id or (select public.is_admin_or_mod()));

create policy quiz_attempts_update on public.quiz_attempts
  for update to authenticated
  using ((select auth.uid()) = student_id or (select public.is_admin_or_mod()))
  with check ((select auth.uid()) = student_id or (select public.is_admin_or_mod()));

create policy quiz_attempts_delete on public.quiz_attempts
  for delete to authenticated
  using ((select auth.uid()) = student_id or (select public.is_admin_or_mod()));

-- ─── forum_threads: public read non-hidden, owner write, mod override ──────
drop policy if exists forum_threads_mod           on public.forum_threads;
drop policy if exists forum_threads_owner_delete  on public.forum_threads;
drop policy if exists forum_threads_owner_write   on public.forum_threads;
drop policy if exists forum_threads_public_read   on public.forum_threads;
drop policy if exists forum_threads_owner_update  on public.forum_threads;

create policy forum_threads_select on public.forum_threads
  for select
  using (is_hidden = false or (select public.is_admin_or_mod()));

create policy forum_threads_insert on public.forum_threads
  for insert to authenticated
  with check ((select auth.uid()) = author_id);

create policy forum_threads_update on public.forum_threads
  for update to authenticated
  using (
    ((select auth.uid()) = author_id and is_hidden = false)
    or (select public.is_admin_or_mod())
  )
  with check (
    (select auth.uid()) = author_id
    or (select public.is_admin_or_mod())
  );

create policy forum_threads_delete on public.forum_threads
  for delete to authenticated
  using ((select auth.uid()) = author_id or (select public.is_admin_or_mod()));

-- ─── forum_replies: same pattern as threads ────────────────────────────────
drop policy if exists forum_replies_mod           on public.forum_replies;
drop policy if exists forum_replies_owner_delete  on public.forum_replies;
drop policy if exists forum_replies_owner_write   on public.forum_replies;
drop policy if exists forum_replies_public_read   on public.forum_replies;
drop policy if exists forum_replies_owner_update  on public.forum_replies;

create policy forum_replies_select on public.forum_replies
  for select
  using (is_hidden = false or (select public.is_admin_or_mod()));

create policy forum_replies_insert on public.forum_replies
  for insert to authenticated
  with check ((select auth.uid()) = author_id);

create policy forum_replies_update on public.forum_replies
  for update to authenticated
  using (
    ((select auth.uid()) = author_id and is_hidden = false)
    or (select public.is_admin_or_mod())
  )
  with check (
    (select auth.uid()) = author_id
    or (select public.is_admin_or_mod())
  );

create policy forum_replies_delete on public.forum_replies
  for delete to authenticated
  using ((select auth.uid()) = author_id or (select public.is_admin_or_mod()));

-- ─── forum_likes: owner-only ───────────────────────────────────────────────
drop policy if exists forum_likes_owner on public.forum_likes;

create policy forum_likes_owner on public.forum_likes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─── forum_reports: reporter sees own, mods see all ────────────────────────
drop policy if exists forum_reports_mod         on public.forum_reports;
drop policy if exists forum_reports_owner_write on public.forum_reports;
drop policy if exists forum_reports_owner_read  on public.forum_reports;

create policy forum_reports_select on public.forum_reports
  for select to authenticated
  using ((select auth.uid()) = reporter_id or (select public.is_admin_or_mod()));

create policy forum_reports_insert on public.forum_reports
  for insert to authenticated
  with check ((select auth.uid()) = reporter_id);

create policy forum_reports_update on public.forum_reports
  for update to authenticated
  using ((select public.is_admin_or_mod()))
  with check ((select public.is_admin_or_mod()));

create policy forum_reports_delete on public.forum_reports
  for delete to authenticated
  using ((select public.is_admin_or_mod()));

-- 20260531233018_secure_quiz_answer_keys.sql
--
-- Audit finding C1 (CRITICAL): quiz_questions.correct_answer was stored on the
-- same row students must read to take a quiz. The quiz_questions SELECT policy
-- grants row-level read to any authenticated user for a published quiz on a
-- published course. RLS is row-level, not column-level, so a student could call
--   GET /rest/v1/quiz_questions?select=correct_answer&quiz_id=eq.<id>
-- and obtain the answer key before/during the attempt — a one-request defeat of
-- every published quiz's integrity.
--
-- Fix: move the answer key into a dedicated table that students have NO RLS read
-- on (teacher-owner + admin only). The student take-page never needs it (grading
-- is server-side); grading reads the key via the service-role admin client, which
-- bypasses RLS. The leaking column is dropped from quiz_questions.

-- 1. Key table: one row per question, teacher/admin readable only.
create table if not exists public.quiz_question_keys (
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_answer jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger quiz_question_keys_set_updated_at
  before update on public.quiz_question_keys
  for each row execute function public.set_updated_at();

alter table public.quiz_question_keys enable row level security;

-- 2. RLS: only the owning course's teacher or an admin may read/write keys.
--    Students (authenticated, non-owner) match no policy -> deny by default.
create policy quiz_question_keys_owner_select on public.quiz_question_keys
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.courses c on c.id = q.course_id
      where qq.id = quiz_question_keys.question_id
        and c.teacher_id = (select auth.uid())
    )
  );

create policy quiz_question_keys_owner_write on public.quiz_question_keys
  for all to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.courses c on c.id = q.course_id
      where qq.id = quiz_question_keys.question_id
        and c.teacher_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_admin())
    or exists (
      select 1
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.courses c on c.id = q.course_id
      where qq.id = quiz_question_keys.question_id
        and c.teacher_id = (select auth.uid())
    )
  );

-- 3. Backfill existing answer keys, then drop the leaking column.
insert into public.quiz_question_keys (question_id, correct_answer)
  select id, correct_answer
  from public.quiz_questions
  where correct_answer is not null  -- defensive: target column is NOT NULL
  on conflict (question_id) do nothing;

alter table public.quiz_questions drop column if exists correct_answer;

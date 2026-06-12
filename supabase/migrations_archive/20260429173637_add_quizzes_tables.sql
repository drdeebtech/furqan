-- 20260429173637_add_quizzes_tables.sql
-- Phase 10 of the 15-feature build plan: Quiz system (text-only).
--
-- Three tables: quizzes (definition), quiz_questions (per-quiz Q's),
-- quiz_attempts (student submissions). Auto-grading for MCQ / fill-in /
-- true_false runs server-side at submit time. KPI 4 on the student
-- dashboard switches to "Upcoming Quiz" countdown when a future quiz
-- exists for an enrolled course.

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid references public.course_lessons(id) on delete set null,
  title_ar text not null,
  title_en text,
  description_ar text,
  description_en text,
  time_limit_minutes integer,
  passing_score_pct integer not null default 70 check (passing_score_pct between 0 and 100),
  available_at timestamptz,
  due_at timestamptz,
  is_published boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quizzes_course_pub_idx
  on public.quizzes (course_id, is_published);

create trigger quizzes_set_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_ar text not null,
  question_en text,
  question_type text not null check (question_type in ('mcq', 'fill_in', 'true_false')),
  options jsonb,         -- [{id, text_ar, text_en}] for MCQ; null for fill_in/true_false
  correct_answer jsonb not null, -- mcq: option_id; fill_in: ["acceptable", "answers"]; true_false: bool
  points integer not null default 1 check (points >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists quiz_questions_quiz_sort_idx
  on public.quiz_questions (quiz_id, sort_order);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers jsonb,       -- { question_id: answer }
  score_pct numeric,   -- null until graded
  passed boolean,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists quiz_attempts_student_quiz_idx
  on public.quiz_attempts (student_id, quiz_id, submitted_at desc);

-- RLS: students see their own attempts + published quiz definitions;
-- teachers see attempts on their own quizzes; admin/mod see all.
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;

-- Quizzes: public read on published quizzes for published courses;
-- teacher who owns the course OR admin/mod has full access.
create policy quizzes_public_read on public.quizzes
  for select using (
    is_published = true and exists (
      select 1 from public.courses c
      where c.id = course_id and c.status = 'published'
    )
  );
create policy quizzes_teacher_write on public.quizzes
  for all using (
    public.is_admin_or_mod() or exists (
      select 1 from public.courses c
      where c.id = course_id and c.teacher_id = auth.uid()
    )
  );

-- Quiz questions: same access as parent quiz.
create policy quiz_questions_public_read on public.quiz_questions
  for select using (
    exists (
      select 1 from public.quizzes q
      join public.courses c on c.id = q.course_id
      where q.id = quiz_id and q.is_published = true and c.status = 'published'
    )
  );
create policy quiz_questions_teacher_write on public.quiz_questions
  for all using (
    public.is_admin_or_mod() or exists (
      select 1 from public.quizzes q
      join public.courses c on c.id = q.course_id
      where q.id = quiz_id and c.teacher_id = auth.uid()
    )
  );

-- Quiz attempts: student owns their own; teacher of the quiz's course
-- can read; admin/mod has full access.
create policy quiz_attempts_owner on public.quiz_attempts
  for all using (auth.uid() = student_id);
create policy quiz_attempts_teacher_read on public.quiz_attempts
  for select using (
    exists (
      select 1 from public.quizzes q
      join public.courses c on c.id = q.course_id
      where q.id = quiz_id and c.teacher_id = auth.uid()
    )
  );
create policy quiz_attempts_admin on public.quiz_attempts
  for all using (public.is_admin_or_mod());

-- Feature flag default
insert into public.platform_settings (key, value, description)
select 'quizzes_enabled', 'true', 'Enables /teacher/courses/.../quizzes and /student/quizzes'
where not exists (
  select 1 from public.platform_settings where key = 'quizzes_enabled'
);

comment on table public.quizzes is 'Quiz definitions per course/lesson. Time-limited and auto-graded text quizzes (MCQ + fill-in + true/false).';
comment on table public.quiz_attempts is 'One row per student attempt; score_pct + passed populated by gradeQuizAttempt at submit time.';

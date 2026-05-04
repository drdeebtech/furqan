-- 20260504234013_add_teacher_mentorship.sql
-- Item #18 from the deep pedagogical analysis (Project Memory/furqan/Runs/
-- 2026-05-04-2313). Teacher quality compounds student outcomes; the
-- platform's session_observers table already enables observation but
-- there's no first-class concept of mentor↔mentee teacher pairing.
--
-- Two tables ship here. Senior teachers mentor junior teachers; observation
-- of selected sessions reuses the existing session_observers infrastructure.
-- Feedback the senior writes about the junior's teaching is its own table —
-- distinct from session_evaluations (which evaluate STUDENTS, not teachers).
--
-- All idempotent.

-- ─── 1. teacher_mentorships ─────────────────────────────────────────────────

create table if not exists public.teacher_mentorships (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.profiles(id) on delete cascade,
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('proposed','active','paused','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mentor_id, mentee_id),
  check (mentor_id <> mentee_id)
);

create index if not exists teacher_mentorships_mentor_idx
  on public.teacher_mentorships(mentor_id) where status = 'active';
create index if not exists teacher_mentorships_mentee_idx
  on public.teacher_mentorships(mentee_id) where status = 'active';

comment on table public.teacher_mentorships is
  'Teacher↔teacher mentor/mentee pairing. Mentor and mentee are both teachers (profiles.role=teacher). Unique on (mentor_id, mentee_id) so a pairing is recorded once per direction.';

alter table public.teacher_mentorships enable row level security;

-- Either party (mentor or mentee) can read their own row.
drop policy if exists teacher_mentorships_party_read on public.teacher_mentorships;
create policy teacher_mentorships_party_read on public.teacher_mentorships
  for select using (mentor_id = auth.uid() or mentee_id = auth.uid());

-- Admin/mod full access (proposing/ending mentorships, audit).
drop policy if exists teacher_mentorships_admin_full on public.teacher_mentorships;
create policy teacher_mentorships_admin_full on public.teacher_mentorships
  for all using (public.is_admin_or_mod());

-- ─── 2. teacher_mentorship_feedback ─────────────────────────────────────────

create table if not exists public.teacher_mentorship_feedback (
  id uuid primary key default gen_random_uuid(),
  mentorship_id uuid not null references public.teacher_mentorships(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  feedback_text text not null,
  severity text not null default 'info' check (severity in ('praise','info','suggestion','concern')),
  written_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists teacher_mentorship_feedback_mentorship_idx
  on public.teacher_mentorship_feedback(mentorship_id, created_at desc);

comment on table public.teacher_mentorship_feedback is
  'Feedback the mentor writes about the mentee, optionally tied to a specific session_id they observed. Distinct from session_evaluations which evaluate students.';

alter table public.teacher_mentorship_feedback enable row level security;

-- Both mentor and mentee read feedback on their own mentorship.
drop policy if exists teacher_mentorship_feedback_party_read on public.teacher_mentorship_feedback;
create policy teacher_mentorship_feedback_party_read on public.teacher_mentorship_feedback
  for select using (
    exists (
      select 1 from public.teacher_mentorships m
      where m.id = teacher_mentorship_feedback.mentorship_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

-- Mentor writes feedback (must be the mentor on the linked mentorship).
drop policy if exists teacher_mentorship_feedback_mentor_write on public.teacher_mentorship_feedback;
create policy teacher_mentorship_feedback_mentor_write on public.teacher_mentorship_feedback
  for insert with check (
    written_by = auth.uid()
    and exists (
      select 1 from public.teacher_mentorships m
      where m.id = teacher_mentorship_feedback.mentorship_id
        and m.mentor_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Admin/mod full access.
drop policy if exists teacher_mentorship_feedback_admin_full on public.teacher_mentorship_feedback;
create policy teacher_mentorship_feedback_admin_full on public.teacher_mentorship_feedback
  for all using (public.is_admin_or_mod());

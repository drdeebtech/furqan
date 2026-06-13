-- 20260504232933_add_ijazah_pathway.sql
-- Item #14 from the deep pedagogical analysis (Project Memory/furqan/Runs/
-- 2026-05-04-2313). Ijazah is the apex of the classical Quran-teaching
-- tradition; the platform's audience explicitly includes "a hāfiz preparing
-- for ijāzah" (.impeccable.md). Without an ijazah surface, the most
-- committed segment of the user base has no in-app representation of their
-- highest goal.
--
-- This migration creates the 4-table schema described in
-- docs/PEDAGOGY_ROADMAP.md §#14. The migration ships with NO seeded
-- pathways — the academy decides what to offer through the admin UI in a
-- follow-up commit. Empty-pathways state is handled gracefully on the
-- student side.
--
-- Tables:
--   1. ijazah_pathways     — credential definitions
--   2. ijazah_requirements — what composes a pathway
--   3. student_ijazah_progress — student enrolled in a pathway
--   4. student_ijazah_requirement_progress — per-requirement tracking
--
-- All idempotent (IF NOT EXISTS / DROP-then-CREATE policies).

-- ─── 1. ijazah_pathways ─────────────────────────────────────────────────────

create table if not exists public.ijazah_pathways (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  recitation_standard text not null check (recitation_standard in
    ('hafs','warsh','qalon','al_duri','shu_ba')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ijazah_pathways_active_idx
  on public.ijazah_pathways(is_active)
  where is_active = true;

comment on table public.ijazah_pathways is
  'Credential pathways the academy offers (e.g. "Hifz al-Quran complete in Hafs"). One pathway, many requirements.';

alter table public.ijazah_pathways enable row level security;

drop policy if exists ijazah_pathways_public_read on public.ijazah_pathways;
create policy ijazah_pathways_public_read on public.ijazah_pathways
  for select using (is_active = true or public.is_admin_or_mod());

drop policy if exists ijazah_pathways_admin_write on public.ijazah_pathways;
create policy ijazah_pathways_admin_write on public.ijazah_pathways
  for all using (public.is_admin_or_mod());

-- ─── 2. ijazah_requirements ─────────────────────────────────────────────────

create table if not exists public.ijazah_requirements (
  id uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.ijazah_pathways(id) on delete cascade,
  requirement_type text not null check (requirement_type in (
    'memorize_surah',
    'memorize_juz',
    'min_sessions_with_teacher',
    'eval_score_threshold',
    'oral_exam_pass',
    'written_exam_pass',
    'other'
  )),
  requirement_payload jsonb not null default '{}'::jsonb,
  sequence integer not null,
  description_ar text not null,
  description_en text not null,
  created_at timestamptz not null default now()
);

create index if not exists ijazah_requirements_pathway_idx
  on public.ijazah_requirements(pathway_id, sequence);

comment on table public.ijazah_requirements is
  'Requirements composing a pathway. payload examples: {"surah_num":2} for memorize_surah, {"min_sessions":40} for min_sessions, {"min_score":8.0,"dimension":"hifz"} for eval_score_threshold.';

alter table public.ijazah_requirements enable row level security;

drop policy if exists ijazah_requirements_public_read on public.ijazah_requirements;
create policy ijazah_requirements_public_read on public.ijazah_requirements
  for select using (
    exists (
      select 1 from public.ijazah_pathways p
      where p.id = ijazah_requirements.pathway_id
        and (p.is_active = true or public.is_admin_or_mod())
    )
  );

drop policy if exists ijazah_requirements_admin_write on public.ijazah_requirements;
create policy ijazah_requirements_admin_write on public.ijazah_requirements
  for all using (public.is_admin_or_mod());

-- ─── 3. student_ijazah_progress ─────────────────────────────────────────────

create table if not exists public.student_ijazah_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  pathway_id uuid not null references public.ijazah_pathways(id),
  enrolled_at timestamptz not null default now(),
  target_completion_at timestamptz,
  completed_at timestamptz,
  issuing_teacher_id uuid references public.profiles(id),
  issued_certificate_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, pathway_id)
);

create index if not exists student_ijazah_progress_student_idx
  on public.student_ijazah_progress(student_id);
create index if not exists student_ijazah_progress_completed_idx
  on public.student_ijazah_progress(completed_at)
  where completed_at is not null;

comment on table public.student_ijazah_progress is
  'A student enrolled in an ijazah pathway. Unique on (student_id, pathway_id) — one student can pursue many pathways but only one row per pathway.';

alter table public.student_ijazah_progress enable row level security;

-- Student reads their own enrolments
drop policy if exists student_ijazah_progress_student_read on public.student_ijazah_progress;
create policy student_ijazah_progress_student_read on public.student_ijazah_progress
  for select using (student_id = auth.uid());

-- Teacher reads enrolments for students they have ever taught (via a
-- non-deleted booking). Does not require being the issuing teacher.
drop policy if exists student_ijazah_progress_teacher_read on public.student_ijazah_progress;
create policy student_ijazah_progress_teacher_read on public.student_ijazah_progress
  for select using (
    exists (
      select 1 from public.bookings b
      where b.teacher_id = auth.uid()
        and b.student_id = student_ijazah_progress.student_id
        and b.deleted_at is null
    )
  );

-- Admin/mod full access
drop policy if exists student_ijazah_progress_admin_full on public.student_ijazah_progress;
create policy student_ijazah_progress_admin_full on public.student_ijazah_progress
  for all using (public.is_admin_or_mod());

-- ─── 4. student_ijazah_requirement_progress ─────────────────────────────────

create table if not exists public.student_ijazah_requirement_progress (
  id uuid primary key default gen_random_uuid(),
  student_progress_id uuid not null references public.student_ijazah_progress(id) on delete cascade,
  requirement_id uuid not null references public.ijazah_requirements(id) on delete cascade,
  met_at timestamptz,
  verifying_teacher_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_progress_id, requirement_id)
);

create index if not exists student_ijazah_req_progress_pathway_idx
  on public.student_ijazah_requirement_progress(student_progress_id);

comment on table public.student_ijazah_requirement_progress is
  'Per-requirement tracking: which requirements has the student met, when, and verified by which teacher.';

alter table public.student_ijazah_requirement_progress enable row level security;

-- Student reads requirement progress for their own enrolments
drop policy if exists student_ijazah_req_progress_student_read on public.student_ijazah_requirement_progress;
create policy student_ijazah_req_progress_student_read on public.student_ijazah_requirement_progress
  for select using (
    exists (
      select 1 from public.student_ijazah_progress sp
      where sp.id = student_ijazah_requirement_progress.student_progress_id
        and sp.student_id = auth.uid()
    )
  );

-- Teacher reads + verifies for students they have ever taught
drop policy if exists student_ijazah_req_progress_teacher_read on public.student_ijazah_requirement_progress;
create policy student_ijazah_req_progress_teacher_read on public.student_ijazah_requirement_progress
  for select using (
    exists (
      select 1 from public.student_ijazah_progress sp
      join public.bookings b on b.student_id = sp.student_id
      where sp.id = student_ijazah_requirement_progress.student_progress_id
        and b.teacher_id = auth.uid()
        and b.deleted_at is null
    )
  );

drop policy if exists student_ijazah_req_progress_teacher_write on public.student_ijazah_requirement_progress;
create policy student_ijazah_req_progress_teacher_write on public.student_ijazah_requirement_progress
  for insert with check (
    verifying_teacher_id = auth.uid()
    and exists (
      select 1 from public.student_ijazah_progress sp
      join public.bookings b on b.student_id = sp.student_id
      where sp.id = student_ijazah_requirement_progress.student_progress_id
        and b.teacher_id = auth.uid()
        and b.deleted_at is null
    )
  );

-- Admin/mod full access
drop policy if exists student_ijazah_req_progress_admin_full on public.student_ijazah_requirement_progress;
create policy student_ijazah_req_progress_admin_full on public.student_ijazah_requirement_progress
  for all using (public.is_admin_or_mod());

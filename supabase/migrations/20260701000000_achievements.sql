-- Spec 033 — student achievement system (badges, Phase 1).
-- first_correction_clean is included in the CHECK enum for forward-compat but
-- is NOT awarded in application code (semantics unresolved — see spec.md OPEN DECISIONS).
create table public.achievements (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in (
                  'first_session',
                  'first_juz',
                  'streak_7',
                  'streak_30',
                  'first_correction_clean',
                  'level_up_intermediate',
                  'level_up_advanced'
                )),
  metadata_json jsonb not null default '{}'::jsonb,
  unlocked_at   timestamptz not null default now(),
  unique (student_id, type)
);

alter table public.achievements enable row level security;

-- Students read their own badges.
create policy achievements_select_own on public.achievements
  for select using (auth.uid() = student_id);

-- A teacher can read badges of students they have taught.
create policy achievements_select_teacher on public.achievements
  for select using (
    exists (
      select 1 from public.bookings b
      where b.student_id = achievements.student_id
        and b.teacher_id = auth.uid()
    )
  );

-- NO insert / update / delete policy — all writes via service-role only.

create index achievements_student_idx on public.achievements(student_id);

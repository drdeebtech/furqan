create table public.student_goals (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users(id) on delete cascade,
  surah_start int not null,
  ayah_start  int not null,
  surah_end   int not null,
  ayah_end    int not null,
  target_date date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint student_goals_range_sanity check (
    surah_start between 1 and 114 and surah_end between 1 and 114
    and ayah_start >= 1 and ayah_end >= 1
    and (surah_start, ayah_start) <= (surah_end, ayah_end)
  )
);

alter table public.student_goals enable row level security;

create policy student_goals_select_own on public.student_goals
  for select using (auth.uid() = student_id);

create policy student_goals_insert_own on public.student_goals
  for insert with check (auth.uid() = student_id);

create policy student_goals_update_own on public.student_goals
  for update using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

create policy student_goals_delete_own on public.student_goals
  for delete using (auth.uid() = student_id);

create policy student_goals_teacher_select on public.student_goals
  for select using (exists (
    select 1
    from public.bookings b
    where b.teacher_id = auth.uid()
      and b.student_id = student_goals.student_id
      and b.deleted_at is null
  ));

create policy student_goals_teacher_insert on public.student_goals
  for insert with check (exists (
    select 1
    from public.bookings b
    where b.teacher_id = auth.uid()
      and b.student_id = student_goals.student_id
      and b.deleted_at is null
  ));

create policy student_goals_teacher_update on public.student_goals
  for update using (exists (
    select 1
    from public.bookings b
    where b.teacher_id = auth.uid()
      and b.student_id = student_goals.student_id
      and b.deleted_at is null
  )) with check (exists (
    select 1
    from public.bookings b
    where b.teacher_id = auth.uid()
      and b.student_id = student_goals.student_id
      and b.deleted_at is null
  ));

create trigger student_goals_set_updated_at
  before update on public.student_goals
  for each row execute function public.set_updated_at();

create unique index student_goals_student_id_idx
  on public.student_goals(student_id);

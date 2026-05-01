-- 20260501175419_group_sessions_phase2_offerings.sql
-- Description: Phase 2 of group lessons — `class_offerings` table.
--
-- A class_offering is "a teacher publishing a slot students can self-enroll
-- into." The teacher CRUDs offerings; students browse offerings (Phase 3)
-- and enrolling creates a regular bookings row linked back via the new
-- bookings.class_offering_id column. When the teacher confirms the class,
-- the existing booking-confirmed → session-creation path produces a single
-- session and every enrolled booking gets bookings.session_id set
-- (re-using the Phase 1 plumbing).

create table if not exists public.class_offerings (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references public.profiles(id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  description     text,
  scheduled_at    timestamptz not null,
  duration_min    int not null check (duration_min between 15 and 240),
  session_type    public.session_type not null,
  capacity        int not null check (capacity between 2 and 20),
  price_usd       numeric(10,2) not null check (price_usd >= 0),
  status          text not null default 'open'
                  check (status in ('open','full','confirmed','cancelled','completed')),
  session_id      uuid references public.sessions(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- updated_at trigger — reuse the canonical helper from v9_001.
drop trigger if exists class_offerings_set_updated_at on public.class_offerings;
create trigger class_offerings_set_updated_at
  before update on public.class_offerings
  for each row execute function public.set_updated_at();

create index if not exists class_offerings_teacher_id_idx
  on public.class_offerings(teacher_id);
create index if not exists class_offerings_status_scheduled_idx
  on public.class_offerings(status, scheduled_at);

-- Bookings learn whether they came from a group offering. Existing 1:1
-- bookings keep this column NULL.
alter table public.bookings
  add column if not exists class_offering_id uuid
    references public.class_offerings(id) on delete set null;

create index if not exists bookings_class_offering_id_idx
  on public.bookings(class_offering_id);

-- RLS: same patterns as the rest of the schema.
--   - teacher: full crud on their own offerings
--   - student: read-only on currently-open offerings (browse list)
--   - admin/moderator: full management
alter table public.class_offerings enable row level security;

drop policy if exists "teacher rw own offerings" on public.class_offerings;
create policy "teacher rw own offerings" on public.class_offerings
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

drop policy if exists "student read open offerings" on public.class_offerings;
create policy "student read open offerings" on public.class_offerings
  for select
  using (status in ('open', 'full', 'confirmed'));

drop policy if exists "admin mod manage offerings" on public.class_offerings;
create policy "admin mod manage offerings" on public.class_offerings
  for all
  using (public.is_admin_or_mod())
  with check (public.is_admin_or_mod());

do $$
begin
  raise notice 'group_sessions_phase2 applied. class_offerings table + bookings.class_offering_id ready.';
end $$;

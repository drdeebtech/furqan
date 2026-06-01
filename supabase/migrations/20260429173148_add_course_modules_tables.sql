-- 20260429173148_add_course_modules_tables.sql
-- Phase 9 of the 15-feature build plan: Module library.
--
-- Adds curriculum modules (groups of lessons) with optional linear
-- ordering. When `modules.is_linear = true`, students must complete
-- earlier lessons in the module before later ones unlock. Otherwise it's
-- a thematic grouping with no gating.
--
-- Lessons can be assigned to at most one module per course; lessons
-- without a module assignment continue to render as a flat fallback
-- list under the course (preserves today's behavior).

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title_ar text not null,
  title_en text,
  description_ar text,
  description_en text,
  is_linear boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists modules_course_sort_idx
  on public.modules (course_id, sort_order);

create trigger modules_set_updated_at
  before update on public.modules
  for each row execute function public.set_updated_at();

-- Lessons-to-modules join. A lesson can belong to at most one module
-- (enforced by the unique constraint on lesson_id).
create table if not exists public.module_lessons (
  module_id uuid not null references public.modules(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (module_id, lesson_id),
  unique (lesson_id)
);

create index if not exists module_lessons_lookup_idx
  on public.module_lessons (module_id, sort_order);

-- RLS: read by anyone enrolled in or owning the parent course; write by
-- course teacher OR admin/moderator.
alter table public.modules enable row level security;
alter table public.module_lessons enable row level security;

-- Public can read modules for any published course (so the catalog +
-- previews work). Restricting per-course at the lesson level instead.
create policy modules_public_read on public.modules
  for select using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.status = 'published'
    )
  );

create policy modules_teacher_write on public.modules
  for all using (
    private.is_admin_or_mod() or exists (
      select 1 from public.courses c
      where c.id = course_id and c.teacher_id = auth.uid()
    )
  );

create policy module_lessons_public_read on public.module_lessons
  for select using (
    exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id and c.status = 'published'
    )
  );

create policy module_lessons_teacher_write on public.module_lessons
  for all using (
    private.is_admin_or_mod() or exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id and c.teacher_id = auth.uid()
    )
  );

-- Feature flag default
insert into public.platform_settings (key, value, description)
select 'modules_enabled', 'true', 'Enables curriculum modules and (when is_linear) lesson-unlock gating'
where not exists (
  select 1 from public.platform_settings where key = 'modules_enabled'
);

comment on table public.modules is
  'Curriculum modules — groups of lessons with optional linear sequencing. When is_linear=true, students must complete earlier lessons in the module before later ones unlock.';
comment on table public.module_lessons is
  'Module ↔ lesson assignment. Lessons unique per (module_id) — a lesson belongs to at most one module.';

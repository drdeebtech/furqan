-- 20260506134112_resources_teacher_visibility.sql
-- Description: extend `resources` so teachers can upload private resources and
-- explicitly assign them to specific students or halaqa cohorts they lead.
--
-- Until now `resources` was admin-curated: admin uploads, public read on
-- `is_published`. Teachers had no upload surface — they DM'd PDFs in chat or
-- relied on whatever admin had loaded. This migration adds the teacher path
-- without disturbing the existing admin/public flow:
--
--   created_by_teacher_id IS NULL  ⇒ admin/global library (existing
--                                    `is_published` + admin-write policies
--                                    still apply, untouched).
--   created_by_teacher_id IS NOT NULL ⇒ teacher-private. Teacher does CRUD
--                                       on own rows; students SELECT only
--                                       via resource_assignments rows.

-- ─── 1. Resources column extension ─────────────────────────────────────────

alter table public.resources
  add column if not exists created_by_teacher_id uuid
  references public.profiles(id) on delete set null;

create index if not exists resources_teacher_owner_idx
  on public.resources (created_by_teacher_id)
  where created_by_teacher_id is not null;

-- ─── 2. Assignments table ──────────────────────────────────────────────────

create table if not exists public.resource_assignments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null
    references public.resources(id) on delete cascade,
  student_id uuid
    references public.profiles(id) on delete cascade,
  halaqa_id uuid
    references public.sessions(id) on delete cascade,
  assigned_by uuid not null
    references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Exactly one target: student OR halaqa, never both, never neither.
  check (
    (student_id is not null)::int + (halaqa_id is not null)::int = 1
  )
);

-- Idempotency: don't allow the same teacher to assign the same resource
-- to the same student (or the same halaqa) twice.
create unique index if not exists resource_assignments_unique_student_idx
  on public.resource_assignments (resource_id, student_id)
  where student_id is not null;

create unique index if not exists resource_assignments_unique_halaqa_idx
  on public.resource_assignments (resource_id, halaqa_id)
  where halaqa_id is not null;

create index if not exists resource_assignments_student_lookup_idx
  on public.resource_assignments (student_id, created_at desc)
  where student_id is not null;

create index if not exists resource_assignments_halaqa_lookup_idx
  on public.resource_assignments (halaqa_id, created_at desc)
  where halaqa_id is not null;

create index if not exists resource_assignments_resource_idx
  on public.resource_assignments (resource_id);

-- ─── 3. RLS — resource_assignments ─────────────────────────────────────────

alter table public.resource_assignments enable row level security;

-- Teachers manage their own assignments (assigned_by = self).
drop policy if exists resource_assignments_teacher_all on public.resource_assignments;
create policy resource_assignments_teacher_all
  on public.resource_assignments
  for all
  to authenticated
  using (assigned_by = auth.uid())
  with check (assigned_by = auth.uid());

-- Students read assignments that target them. Read-only.
drop policy if exists resource_assignments_student_read on public.resource_assignments;
create policy resource_assignments_student_read
  on public.resource_assignments
  for select
  to authenticated
  using (student_id = auth.uid());

-- Admin / moderator see everything.
drop policy if exists resource_assignments_admin_all on public.resource_assignments;
create policy resource_assignments_admin_all
  on public.resource_assignments
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'moderator')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'moderator')
    )
  );

-- ─── 4. RLS — resources, additive policies for teacher-owned rows ─────────

-- Teachers do CRUD on rows where created_by_teacher_id = self.
drop policy if exists resources_teacher_own on public.resources;
create policy resources_teacher_own
  on public.resources
  for all
  to authenticated
  using (created_by_teacher_id = auth.uid())
  with check (created_by_teacher_id = auth.uid());

-- Students SELECT teacher-owned resources via an active assignment.
drop policy if exists resources_student_via_assignment on public.resources;
create policy resources_student_via_assignment
  on public.resources
  for select
  to authenticated
  using (
    created_by_teacher_id is not null
    and exists (
      select 1 from public.resource_assignments ra
      where ra.resource_id = id
        and ra.student_id = auth.uid()
    )
  );

-- (Pre-existing public-read on `is_published = true` and admin-write
-- policies are NOT modified here — `created_by_teacher_id IS NULL`
-- preserves existing semantics for the admin-curated library.)

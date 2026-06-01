-- 20260429171817_add_resources_library.sql
-- Phase 6 of the 15-feature build plan: Resources library.
--
-- A general-purpose study-materials library decoupled from courses:
-- mushaf PDFs, recitation audio references, dua lists, link bookmarks,
-- etc. Two surfaces: public read at /student/resources, admin author at
-- /admin/resources.

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null,
  title_en text,
  description_ar text,
  description_en text,
  resource_type text not null check (resource_type in ('pdf','audio','link','video','image')),
  -- file_url: a Supabase Storage path (used for pdf/audio/video/image when
  -- uploaded). external_url: an off-platform link (used for `link` type or
  -- when the asset lives elsewhere). At least one must be set.
  file_url text,
  external_url text,
  category text not null default 'general',
  tags text[] not null default array[]::text[],
  is_published boolean not null default false,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (file_url is not null or external_url is not null)
);

create index if not exists resources_published_type_idx
  on public.resources (is_published, resource_type, category);

create trigger resources_set_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

-- RLS: public read on published rows; admin-only writes.
alter table public.resources enable row level security;

create policy resources_public_read on public.resources
  for select using (is_published = true);

create policy resources_admin_all on public.resources
  for all using (private.is_admin());

-- Storage bucket for uploaded files (PDFs, audio, etc.). Created if not
-- already present. Public bucket so signed URLs aren't required for the
-- common case; admin restricts who can upload via the admin policy below.
insert into storage.buckets (id, name, public)
values ('resources', 'resources', true)
on conflict (id) do nothing;

-- Storage RLS: public read; admin write/delete. Drop-then-create for
-- idempotency since Postgres `create policy` doesn't support if-not-exists.
drop policy if exists "resources bucket public read" on storage.objects;
create policy "resources bucket public read"
  on storage.objects for select
  using (bucket_id = 'resources');

drop policy if exists "resources bucket admin write" on storage.objects;
create policy "resources bucket admin write"
  on storage.objects for insert
  with check (bucket_id = 'resources' and private.is_admin());

drop policy if exists "resources bucket admin update" on storage.objects;
create policy "resources bucket admin update"
  on storage.objects for update
  using (bucket_id = 'resources' and private.is_admin());

drop policy if exists "resources bucket admin delete" on storage.objects;
create policy "resources bucket admin delete"
  on storage.objects for delete
  using (bucket_id = 'resources' and private.is_admin());

-- Feature flag default
insert into public.platform_settings (key, value, description)
select 'resources_enabled', 'true', 'Enables /student/resources and /admin/resources'
where not exists (
  select 1 from public.platform_settings where key = 'resources_enabled'
);

comment on table public.resources is
  'Free-floating study materials (PDFs, audio, links, etc.) decoupled from courses. Public-readable when is_published=true; admin-authored at /admin/resources.';

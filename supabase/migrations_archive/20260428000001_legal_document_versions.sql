-- legal_document_versions — immutable history table for terms + privacy.
--
-- Every save in /admin/legal snapshots the prior body of that kind into
-- here BEFORE updating legal_documents. The current row stays in
-- legal_documents (unchanged); this table is append-only and admin-read.
--
-- Columns:
--   - kind: 'terms' | 'privacy'
--   - version: integer that matches what legal_documents had when this
--     row was created (i.e. the version being superseded).
--   - body_ar / body_en: the snapshot.
--   - effective_at: when this body was the live one (legal_documents.updated_at
--     at the time of save).
--   - superseded_at: filled in when a NEW version replaces this one.
--   - saved_by: the admin who triggered the snapshot (auth.users.id).

create table if not exists public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy')),
  version int not null,
  body_ar text,
  body_en text,
  effective_at timestamptz not null,
  superseded_at timestamptz,
  saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists legal_versions_kind_version_idx
  on public.legal_document_versions (kind, version desc);

alter table public.legal_document_versions enable row level security;

drop policy if exists legal_versions_admin_read on public.legal_document_versions;
create policy legal_versions_admin_read on public.legal_document_versions
  for select using (is_admin());

drop policy if exists legal_versions_admin_write on public.legal_document_versions;
create policy legal_versions_admin_write on public.legal_document_versions
  for all using (is_admin()) with check (is_admin());

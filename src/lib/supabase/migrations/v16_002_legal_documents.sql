-- v16_002: legal_documents — admin-editable terms of service + privacy policy.
--
-- Approach: one row per document kind. body_ar / body_en start NULL — public
-- pages then render the existing in-code JSX as a fallback. The moment an
-- admin saves a body via /admin/legal, that override kicks in and the JSX
-- is bypassed. version auto-bumps on each save (handled in the server action,
-- not via trigger, so we can audit_log the previous version cleanly).
--
-- Format note: body is plain text with two formatting affordances:
--   ## Heading
--   - List item
-- Everything else is treated as a paragraph, separated by blank lines.
-- This avoids adding a markdown dep for legal text that changes rarely.

create table if not exists public.legal_documents (
  kind text primary key check (kind in ('terms', 'privacy')),
  body_ar text,
  body_en text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.legal_documents enable row level security;

drop policy if exists legal_anon_read on public.legal_documents;
create policy legal_anon_read on public.legal_documents for select using (true);

drop policy if exists legal_admin_write on public.legal_documents;
create policy legal_admin_write on public.legal_documents for all
  using (is_admin()) with check (is_admin());

-- Seed two empty rows so admin can find them in the editor.
insert into public.legal_documents (kind, body_ar, body_en) values
  ('terms', null, null),
  ('privacy', null, null)
on conflict (kind) do nothing;

insert into schema_migrations (version, description)
  values ('v16_002', 'legal_documents — admin-editable terms + privacy with JSX fallback')
  on conflict do nothing;

-- 20260503195950_add_remote_handoff_tokens.sql
-- Description: One-time, single-use codes that let an admin signed in on
-- desktop hand off a fresh authenticated session to their phone via QR.
-- Code is hashed at rest; the matching Supabase magic-link token_hash
-- is stored alongside it and consumed server-side at /auth/confirm.
-- See plan: /Users/drdeeb/.claude/plans/skip-to-main-content-splendid-swan.md

create table if not exists public.remote_handoff_tokens (
  id                  uuid primary key default gen_random_uuid(),
  code_hash           text not null,
  admin_user_id       uuid not null references auth.users(id) on delete cascade,
  target_path         text not null,
  supabase_token_hash text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '5 minutes'),
  used_at             timestamptz,
  used_ip             inet,
  used_ua             text,
  -- Defense-in-depth: keep open redirects out at the storage layer too,
  -- not just at the application layer.
  constraint remote_handoff_tokens_target_path_admin_only
    check (target_path like '/admin/%' and target_path not like '//%')
);

create unique index if not exists idx_remote_handoff_code_hash
  on public.remote_handoff_tokens (code_hash);

-- Partial index supports the cleanup cron's "expired + unused" sweep without
-- carrying every used row in the index.
create index if not exists idx_remote_handoff_cleanup
  on public.remote_handoff_tokens (expires_at)
  where used_at is null;

-- Lookup index for the per-admin "is there an unexpired live code?" check
-- the rate limiter performs in `requestHandoff`.
create index if not exists idx_remote_handoff_admin_active
  on public.remote_handoff_tokens (admin_user_id, expires_at)
  where used_at is null;

alter table public.remote_handoff_tokens enable row level security;

-- No policies on purpose. Only the service-role admin client (which bypasses
-- RLS) reads or writes this table — the API route under
-- /api/auth/handoff/[code] and the server action `requestHandoff` are the
-- only legitimate touch points. RLS denial is the safety net against any
-- future accidental anon-key access.

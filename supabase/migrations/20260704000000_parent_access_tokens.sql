-- Magic-link parent portal (#563): a teacher mints a scoped, expiring,
-- revocable token that lets a parent view a read-only progress summary for one
-- child at /parent/[token] — no account, no login.
--
-- Security model: the token string is a high-entropy random secret (minted
-- server-side). The public portal reads via the SERVICE-ROLE key (bypasses RLS)
-- with an explicit `token = ? and revoked_at is null and expires_at > now()`
-- filter — fail-closed. RLS below governs who may MINT/REVOKE/LIST tokens
-- (the owning teacher, or an admin); there is intentionally NO anon policy, so
-- the table is never readable by the authenticated/anon roles of a parent.

create table if not exists public.parent_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_parent_access_tokens_student on public.parent_access_tokens(student_id);
create index if not exists idx_parent_access_tokens_teacher on public.parent_access_tokens(teacher_id);

alter table public.parent_access_tokens enable row level security;

-- The owning teacher (or an admin) may list their tokens.
create policy parent_tokens_select on public.parent_access_tokens
  for select using (teacher_id = (select auth.uid()) or private.is_admin());

-- Mint: only as oneself (teacher_id must be the caller) or admin.
create policy parent_tokens_insert on public.parent_access_tokens
  for insert with check (teacher_id = (select auth.uid()) or private.is_admin());

-- Revoke = update revoked_at; same ownership guard on both sides.
create policy parent_tokens_update on public.parent_access_tokens
  for update using (teacher_id = (select auth.uid()) or private.is_admin())
  with check (teacher_id = (select auth.uid()) or private.is_admin());

-- No delete policy: tokens are revoked (audit trail), never hard-deleted.

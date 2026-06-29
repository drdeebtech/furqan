-- Magic-link parent portal (#563): a teacher mints a scoped, expiring,
-- revocable token that lets a parent view a read-only progress summary for one
-- child at /parent/[token] — no account, no login.
--
-- Security model: the token is a high-entropy random secret shown to the teacher
-- ONCE; only its SHA-256 digest is stored (`token_hash`), so a DB/backup leak
-- never yields working links. The public portal hashes the presented token and
-- reads via the SERVICE-ROLE key (RLS-bypassing) with an explicit
-- `token_hash = ? and revoked_at is null and expires_at > now()` filter —
-- fail-closed. RLS below governs who may MINT/REVOKE/LIST (the owning teacher of
-- the student, or an admin); there is intentionally NO anon policy.

create table if not exists public.parent_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
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

-- Mint: as oneself AND only for a student the teacher actually teaches (a
-- booking links them) — admins bypass. This mirrors the domain check so the DB
-- boundary alone forbids minting a token for an unrelated student. (#563 CR-CRIT)
create policy parent_tokens_insert on public.parent_access_tokens
  for insert with check (
    private.is_admin()
    or (
      teacher_id = (select auth.uid())
      and exists (
        select 1 from public.bookings b
        where b.teacher_id = (select auth.uid())
          and b.student_id = parent_access_tokens.student_id
      )
    )
  );

-- Update is allowed for the owner/admin, but a trigger (below) restricts it to
-- revocation only — no extending expiry or re-pointing the token. (#563 CR-CRIT)
create policy parent_tokens_update on public.parent_access_tokens
  for update using (teacher_id = (select auth.uid()) or private.is_admin())
  with check (teacher_id = (select auth.uid()) or private.is_admin());

-- No delete policy: tokens are revoked (audit trail), never hard-deleted.

-- Revoke-only guard: every column except revoked_at is immutable after insert,
-- so a compromised/curious owner can't extend access or change the student.
create or replace function private.guard_parent_token_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.token_hash is distinct from old.token_hash
     or new.student_id is distinct from old.student_id
     or new.teacher_id is distinct from old.teacher_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'parent_access_tokens: only revoked_at may be updated';
  end if;
  return new;
end;
$$;

create trigger t_guard_parent_token_update
  before update on public.parent_access_tokens
  for each row execute function private.guard_parent_token_update();

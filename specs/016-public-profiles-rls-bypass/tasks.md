# 016 — tasks (Builder = OpenCode)

> Working dir: this worktree (`/home/drdeeb/furqan-pp`, branch refactor/follow-up-collapse).
> ONE new forward migration. Do not touch the baseline or migrations_archive/. No db push.

## T1 — forward migration
Create `supabase/migrations/20260613130000_lockdown_public_profiles_grants.sql`:

```sql
-- Spec 016 / cursor-bot HIGH (verified live): public.public_profiles is a postgres-owned,
-- non-security_invoker auto-updatable view over profiles, granted ALL to anon+authenticated.
-- Via Supabase REST that lets anon enumerate every profile (PII) and UPDATE/DELETE arbitrary
-- rows, bypassing profiles RLS (owner-rights view). Restore the archived control: revoke all,
-- grant SELECT to authenticated only. service_role/postgres unaffected. View kept owner-rights
-- (NOT security_invoker) on purpose — it is a controlled non-PII projection the 13 authenticated
-- callers rely on; security_invoker would re-impose relationship-scoped profiles RLS and break them.
revoke all on table public.public_profiles from anon;
revoke all on table public.public_profiles from authenticated;
grant select on table public.public_profiles to authenticated;
```

(Idempotent: revoke of an absent grant is a no-op; grant is repeatable.)

## T2 — local verify (no db push)
- `supabase db reset` (applies all migrations in order; must be clean).
- Grants check:
  `select grantee, string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_name='public_profiles' group by grantee;`
  → expect `anon` absent, `authenticated` = `SELECT`, `service_role` = full.
- Role matrix (psql, single tx each): set role anon → `select * from public.public_profiles` **denied**;
  set role authenticated → `select id, full_name from public.public_profiles` **ok**, `delete from public.public_profiles` **denied**.
- `npx tsc --noEmit` clean.

## Done when
Grants are anon=none / authenticated=SELECT / service_role=full; anon SELECT denied; authenticated DML denied; db reset + tsc green; scope = one migration. Do NOT commit, do NOT push.

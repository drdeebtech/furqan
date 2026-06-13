# 014 — tasks (Builder = OpenCode)

> One migration. Do not expand scope. Stop and list any deviation.

## T1 — forward migration
Create `supabase/migrations/20260613120000_session_participant_secdef.sql`:

```sql
-- spec 014 / 012 §2.5: make the RLS helper SECURITY DEFINER so its read of
-- session_participants bypasses that table's RLS, breaking the
-- sessions -> session_participants -> sessions policy recursion (42P17).
create or replace function public.user_is_session_participant(s_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.session_participants
    where session_id = s_id
      and user_id = auth.uid()
  );
$$;
```

Keep the body byte-identical to the live definition except for adding `security definer`.

## T2 — local verify (no db push)
- `supabase db reset` → applies cleanly in order.
- `psql … -c "select prosecdef, provolatile, prolang::regtype is not null from pg_proc where proname='user_is_session_participant';"` → `prosecdef = t`, `provolatile = s`.
- Confirm `SELECT * FROM sessions` as an authenticated participant raises **no** 42P17.
- `npx tsc --noEmit` clean (sanity; no TS touched).

## Done when
prosecdef = t, db reset clean, no recursion, scope == this one migration.

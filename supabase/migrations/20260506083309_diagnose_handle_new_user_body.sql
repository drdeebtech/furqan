-- Read-only diagnostic. Emits NOTICE lines to the CI log so we can see:
--   1. The body of every trigger function on auth.users
--   2. The current column / NOT NULL / default state of every table the
--      trigger writes into (heuristic: look up tables the function body
--      mentions via pg_get_functiondef + grep)
--   3. Triggers, FKs, and check constraints on those tables
-- No DDL changes. Pure introspection.
--
-- Context: PR #95 granted EXECUTE on private.handle_new_user() to
-- supabase_auth_admin (the do-block introspection found the function in
-- the `private` schema, not `public` as src/lib/supabase/schema.sql implies).
-- If that grant didn't fix the signup error (Sentry JAVASCRIPT-NEXTJS-E4-1T
-- "Database error saving new user"), the trigger body itself is throwing —
-- most likely a NOT NULL column on profiles added without a default, or a
-- failing FK to a row that doesn't exist for new users. This dump tells us
-- which.

do $$
declare
  trg record;
  body text;
  col record;
  cons record;
begin
  -- ── (1) Dump the body of every auth.users trigger function ──
  for trg in
    select
      n.nspname as schema_name,
      p.proname as func_name,
      p.oid    as func_oid
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace nc on nc.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where nc.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
  loop
    body := pg_get_functiondef(trg.func_oid);
    raise notice '=== auth.users trigger fn body: %.%() ===', trg.schema_name, trg.func_name;
    raise notice '%', body;
    raise notice '=== end body ===';
  end loop;

  -- ── (2) Dump current schema of public.profiles ──
  raise notice '=== public.profiles columns ===';
  for col in
    select
      column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    order by ordinal_position
  loop
    raise notice 'col: % | type: % | nullable: % | default: %',
      col.column_name, col.data_type, col.is_nullable,
      coalesce(col.column_default, '(none)');
  end loop;

  -- ── (3) Dump check constraints + FKs on public.profiles ──
  raise notice '=== public.profiles constraints ===';
  for cons in
    select
      con.conname,
      con.contype,
      pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'profiles'
  loop
    raise notice 'constraint % (% type): %', cons.conname, cons.contype, cons.def;
  end loop;

  -- ── (4) Dump triggers on public.profiles ──
  raise notice '=== public.profiles triggers ===';
  for trg in
    select
      t.tgname,
      n.nspname as fn_schema,
      p.proname as fn_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace nc on nc.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where nc.nspname = 'public' and c.relname = 'profiles' and not t.tgisinternal
  loop
    raise notice 'trigger % → %.%()', trg.tgname, trg.fn_schema, trg.fn_name;
  end loop;

  raise notice '=== end diagnostic ===';
end $$;

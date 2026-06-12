-- Clear Supabase performance advisor warnings (3 classes).
--
-- Background (from `npm run sb:advisors` performance pass):
--   1. ~80 `auth_rls_initplan` warnings — RLS policies call auth.uid() (etc)
--      directly, which Postgres re-evaluates per row. Wrap in (select ...)
--      so the planner caches the value once per query.
--   2. Hundreds of `multiple_permissive_policies` warnings — overlapping
--      pairs of legacy "Title Case" policies and short-named canonical
--      policies on the same role/cmd. Postgres OR-combines them, doubling
--      RLS evaluation cost. Drop the legacy ones; keep the canonical.
--   3. 3 `duplicate_index` warnings — drop the redundant index in each pair.
--
-- All three are WARN level (non-blocking) but materially affect query
-- latency at scale. Whole migration runs in one implicit transaction; if
-- any part fails, prod is unchanged.

-- ═════════════════════════════════════════════════════════════════════════
-- Part A — Drop 3 duplicate indexes (zero risk, idempotent)
-- ═════════════════════════════════════════════════════════════════════════

drop index if exists public.idx_audit_created;       -- ≡ idx_audit_log_created_at
drop index if exists public.idx_notifications_user;  -- ≡ idx_notifications_user_unread
drop index if exists public.idx_ijaza_teacher;       -- ≡ idx_teacher_ijaza_teacher

-- ═════════════════════════════════════════════════════════════════════════
-- Part B — Drop redundant "Title Case" overlapping permissive policies.
-- Each is paired in pg_policies with a short-named canonical policy that
-- covers the same (table, cmd, role) — confirmed by the multiple_permissive
-- advisor having flagged ≥2 permissive policies for each pair, so dropping
-- exactly one leaves ≥1. DROP IF EXISTS = idempotent re-run.
-- ═════════════════════════════════════════════════════════════════════════

-- audit_log
drop policy if exists "Admins read audit log" on public.audit_log;

-- blog_posts — SKIPPED: no canonical short-named policies exist on this
-- table. Both flagged policies are the actual source of truth. Dropping
-- either would un-protect blog_posts entirely. Lingers as ~2 multiple_permissive
-- warnings; fix is a separate refactor that introduces blog_posts_select +
-- blog_posts_admin_write canonical policies. Out of scope for this perf pass.
-- drop policy if exists "Admins full access" on public.blog_posts;
-- drop policy if exists "Public can read published posts" on public.blog_posts;

-- conversations
drop policy if exists "Users create conversations" on public.conversations;
drop policy if exists "Users see their own conversations" on public.conversations;
drop policy if exists "Users update their conversations" on public.conversations;

-- messages
drop policy if exists "Users send messages in their conversations" on public.messages;
drop policy if exists "Users see messages in their conversations" on public.messages;
drop policy if exists "Users mark messages as read" on public.messages;

-- student_progress
drop policy if exists "Students see own progress" on public.student_progress;
drop policy if exists "Teachers see their students progress" on public.student_progress;
drop policy if exists "Teachers create progress records" on public.student_progress;
drop policy if exists "Teachers update progress records" on public.student_progress;

-- recitation_errors
drop policy if exists "Access recitation errors via progress" on public.recitation_errors;
drop policy if exists "Teachers create recitation errors" on public.recitation_errors;
drop policy if exists "Teachers update recitation errors" on public.recitation_errors;

-- notifications
drop policy if exists "Users see own notifications" on public.notifications;
drop policy if exists "Users update own notifications" on public.notifications;
drop policy if exists "Admins create notifications" on public.notifications;

-- reviews
drop policy if exists "Students create reviews" on public.reviews;
drop policy if exists "Teachers reply to reviews" on public.reviews;
drop policy if exists "Admins full access to reviews" on public.reviews;
drop policy if exists "Public can read public reviews" on public.reviews;
-- NOTE: admin_delete_review is the CANONICAL DELETE policy for reviews
-- (short-named, business-specific). Earlier draft mistakenly listed it
-- as legacy. KEEP it — do not drop.

-- payments
drop policy if exists "Students see own payments" on public.payments;
drop policy if exists "Admins full access to payments" on public.payments;

-- invoices
drop policy if exists "Students see own invoices" on public.invoices;
drop policy if exists "Admins full access to invoices" on public.invoices;

-- payment_transactions
drop policy if exists "Admins see payment transactions" on public.payment_transactions;

-- refund_policies
drop policy if exists "Admins full access to refund policies" on public.refund_policies;
drop policy if exists "Public can read active refund policies" on public.refund_policies;

-- student_credits
drop policy if exists "Students see own credits" on public.student_credits;
drop policy if exists "Admins full access to credits" on public.student_credits;

-- teacher_ijaza
drop policy if exists "Teachers see own ijaza" on public.teacher_ijaza;
drop policy if exists "Admins full access to ijaza" on public.teacher_ijaza;
drop policy if exists "Public can read verified ijaza" on public.teacher_ijaza;

-- teacher_availability
drop policy if exists "Teachers manage own availability" on public.teacher_availability;
drop policy if exists "Public can read active availability" on public.teacher_availability;

-- site_announcements — SKIPPED: only `admin_manage_announcements` would
-- remain after dropping `public_read_active_announcements`, which means anon
-- users would lose read access to active announcements (admin_manage gates
-- on admin role). Lingers as ~1 multiple_permissive warning; fix is to add
-- a `site_announcements_public_select` canonical policy and then drop the
-- legacy. Out of scope for this perf pass.
-- drop policy if exists "public_read_active_announcements" on public.site_announcements;

-- Post-Part-B sanity: every table we *actually dropped from* still has at
-- least one permissive policy. blog_posts and site_announcements are
-- intentionally excluded from the check list — we deliberately skipped
-- their drops because they have no canonical replacement, so they keep
-- their original policies and need no protection check here.
do $$
declare
  bad_table text;
begin
  select tablename into bad_table
  from (
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
      and c.relname in (
        'audit_log', 'conversations', 'messages',
        'student_progress', 'recitation_errors', 'notifications', 'reviews',
        'payments', 'invoices', 'payment_transactions', 'refund_policies',
        'student_credits', 'teacher_ijaza', 'teacher_availability'
      )
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.permissive = 'PERMISSIVE'
      )
  ) sub
  limit 1;

  if bad_table is not null then
    raise exception 'Part B post-check: table %.% has no permissive policies left after legacy drops; canonical replacement missing', 'public', bad_table;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Part C — Wrap auth.<fn>() calls with (select ...) to avoid per-row
-- re-evaluation. Iterates every public-schema policy whose qual or
-- with_check contains a bare auth.<fn>() not already wrapped, drops it, and
-- recreates it with the rewritten expression. Preserves name, permissive
-- flag, role list, and cmd.
--
-- Self-validating: post-loop assertion ensures no unwrapped auth.<fn>()
-- calls remain — raises if regex missed any.
-- ═════════════════════════════════════════════════════════════════════════

-- Strategy: use ALTER POLICY ... USING / WITH CHECK to update expression
-- only. Avoids the name/role/permissive preservation complexity of
-- DROP+CREATE. Uses an alternation regex with explicit non-word-char
-- boundary instead of \m, which proved unreliable in the first attempt.
-- Cleanup pass collapses any double-wrapping introduced by the regex.
do $$
declare
  pol record;
  new_qual text;
  new_check text;
  rewritten_count int := 0;
  remaining_count int;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual ~ '(^|[^[:alnum:]_])auth\.\w+\s*\(\s*\)')
        or
        (with_check is not null and with_check ~ '(^|[^[:alnum:]_])auth\.\w+\s*\(\s*\)')
      )
  loop
    -- 3-pass placeholder strategy. Postgres `pg_get_expr` renders
    -- `(select auth.uid())` as `(SELECT auth.uid() AS uid)` because the
    -- subquery's single target list entry gets the function output column
    -- name as an explicit AS alias. A naive single-pass wrap-then-cleanup
    -- ate the outer `(SELECT` opening paren and stranded the trailing
    -- `) AS uid)` fragment in v3. Masking the already-wrapped form as one
    -- atomic placeholder avoids that whole class of overlap-edit bugs.

    -- Pass 1: mask already-wrapped `(SELECT auth.fn() [AS alias])` so the
    -- wrap pass below can't re-process them.
    new_qual := regexp_replace(
      coalesce(pol.qual, ''),
      '\(\s*SELECT\s+auth\.(\w+)\s*\(\s*\)(\s+AS\s+\w+)?\s*\)',
      '__WRAPPED_AUTH_\1__',
      'gi'
    );
    new_check := regexp_replace(
      coalesce(pol.with_check, ''),
      '\(\s*SELECT\s+auth\.(\w+)\s*\(\s*\)(\s+AS\s+\w+)?\s*\)',
      '__WRAPPED_AUTH_\1__',
      'gi'
    );

    -- Pass 2: wrap any remaining bare auth.fn() calls.
    new_qual := regexp_replace(
      new_qual,
      '(^|[^[:alnum:]_])auth\.(\w+)\s*\(\s*\)',
      '\1(select auth.\2())',
      'g'
    );
    new_check := regexp_replace(
      new_check,
      '(^|[^[:alnum:]_])auth\.(\w+)\s*\(\s*\)',
      '\1(select auth.\2())',
      'g'
    );

    -- Pass 3: restore placeholder to canonical wrapped form.
    new_qual := regexp_replace(new_qual, '__WRAPPED_AUTH_(\w+)__', '(select auth.\1())', 'g');
    new_check := regexp_replace(new_check, '__WRAPPED_AUTH_(\w+)__', '(select auth.\1())', 'g');

    -- Apply via ALTER POLICY (handles USING/WITH CHECK independently).
    if pol.qual is not null and pol.with_check is not null then
      execute format(
        'alter policy %I on %I.%I using (%s) with check (%s)',
        pol.policyname, pol.schemaname, pol.tablename, new_qual, new_check
      );
    elsif pol.qual is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        pol.policyname, pol.schemaname, pol.tablename, new_qual
      );
    elsif pol.with_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        pol.policyname, pol.schemaname, pol.tablename, new_check
      );
    end if;

    rewritten_count := rewritten_count + 1;
  end loop;

  raise notice 'Part C: rewrote % policies', rewritten_count;

  -- Post-loop assertion: zero un-wrapped auth.<fn>() calls remain.
  -- Note `!~*` is the case-insensitive negation operator — pg_get_expr
  -- renders `(select auth.uid())` as `(SELECT auth.uid() AS uid)` (uppercase),
  -- so a case-sensitive lowercase check would falsely flag every wrapped
  -- policy as still-bare. The bare-match regex stays case-sensitive
  -- (Postgres function names are stored lowercase).
  select count(*) into remaining_count
  from pg_policies
  where schemaname = 'public'
    and (
      (qual is not null and qual ~ '(^|[^[:alnum:]_])auth\.\w+\s*\(\s*\)' and qual !~* '\(\s*select\s+auth\.\w+\s*\(')
      or
      (with_check is not null and with_check ~ '(^|[^[:alnum:]_])auth\.\w+\s*\(\s*\)' and with_check !~* '\(\s*select\s+auth\.\w+\s*\(')
    );

  if remaining_count > 0 then
    raise exception 'Part C post-check: % policies still have unwrapped auth.fn() calls after rewrite', remaining_count;
  end if;
end $$;

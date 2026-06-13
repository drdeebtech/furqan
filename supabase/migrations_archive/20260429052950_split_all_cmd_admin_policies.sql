-- Eliminate the remaining `multiple_permissive_policies` advisor warnings
-- caused by `cmd=ALL` admin/all-cmd policies overlapping with cmd-specific
-- user policies on the same table.
--
-- Background:
--   Earlier perf migrations cleared 80 bare-auth policies, 3 dup indexes,
--   and 8 canonical-vs-canonical overlaps. ~250 advisor warnings remain.
--   Root pattern is identical across 27 tables: one permissive policy with
--   `cmd = 'ALL'` (e.g. `messages_admin`, `ta_all`) + one or more permissive
--   policies for specific cmds (e.g. `msg_select`, `ta_select`). The advisor
--   expands `ALL` to {SELECT,INSERT,UPDATE,DELETE} for overlap detection,
--   so the `ALL` policy clashes with every cmd-specific policy on the table.
--
-- Fix per affected table:
--   1. For each existing cmd-specific policy, OR-merge the cmd=ALL predicate
--      into its USING and/or WITH CHECK expression via ALTER POLICY.
--   2. For each cmd in {SELECT,INSERT,UPDATE,DELETE} that has NO cmd-specific
--      policy on the table, create a new cmd-specific policy carrying just
--      the cmd=ALL predicate (preserves admin coverage on uncovered cmds).
--   3. DROP the cmd=ALL policy.
--
-- After this runs, every table has at most ONE permissive policy per
-- (cmd, role) → advisor count drops to 0 on these 27 tables.
--
-- Semantic equivalence proof: the union of {qual_all OR qual_specific} on
-- a single per-cmd policy gives the same row-set as evaluating two
-- permissive policies separately and OR-ing their results. Postgres's RLS
-- combiner does exactly that OR by definition.

do $$
declare
  all_pol record;
  user_pol record;
  cmd_text text;
  has_user boolean;
  effective_check text;
  new_policy_name text;
  rewrites int := 0;
  creates int := 0;
  drops int := 0;
begin
  for all_pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and cmd = 'ALL'
      and tablename in (
        'availability_exceptions', 'blog_posts', 'communication_preferences',
        'contact_submissions', 'conversations', 'homework_assignments',
        'legal_document_versions', 'legal_documents', 'messages', 'packages',
        'refund_policies', 'services', 'session_notes_history',
        'session_presence_events', 'sessions', 'site_announcements',
        'site_blog_categories', 'site_faqs', 'site_features', 'student_credits',
        'student_packages', 'student_progress', 'teacher_availability',
        'teacher_ijaza', 'teacher_languages', 'teacher_recitations',
        'teacher_specialties'
      )
  loop
    -- For a cmd=ALL policy, Postgres uses `qual` as the WITH CHECK target
    -- on INSERT/UPDATE when `with_check` is null. Mirror that here.
    effective_check := coalesce(all_pol.with_check, all_pol.qual);

    -- Step 1: merge the cmd=ALL predicate into each existing cmd-specific
    -- permissive policy on this table.
    for user_pol in
      select policyname, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and tablename = all_pol.tablename
        and cmd <> 'ALL'
        and permissive = 'PERMISSIVE'
    loop
      if user_pol.cmd = 'SELECT' then
        execute format(
          'alter policy %I on %I.%I using ((%s) or (%s))',
          user_pol.policyname, all_pol.schemaname, all_pol.tablename,
          user_pol.qual, all_pol.qual
        );

      elsif user_pol.cmd = 'INSERT' then
        execute format(
          'alter policy %I on %I.%I with check ((%s) or (%s))',
          user_pol.policyname, all_pol.schemaname, all_pol.tablename,
          user_pol.with_check, effective_check
        );

      elsif user_pol.cmd = 'UPDATE' then
        if user_pol.with_check is not null then
          execute format(
            'alter policy %I on %I.%I using ((%s) or (%s)) with check ((%s) or (%s))',
            user_pol.policyname, all_pol.schemaname, all_pol.tablename,
            user_pol.qual, all_pol.qual,
            user_pol.with_check, effective_check
          );
        else
          execute format(
            'alter policy %I on %I.%I using ((%s) or (%s))',
            user_pol.policyname, all_pol.schemaname, all_pol.tablename,
            user_pol.qual, all_pol.qual
          );
        end if;

      elsif user_pol.cmd = 'DELETE' then
        execute format(
          'alter policy %I on %I.%I using ((%s) or (%s))',
          user_pol.policyname, all_pol.schemaname, all_pol.tablename,
          user_pol.qual, all_pol.qual
        );
      end if;

      rewrites := rewrites + 1;
    end loop;

    -- Step 2: for each cmd with NO existing cmd-specific policy on this
    -- table, create a new cmd-specific policy carrying the all-cmd predicate.
    foreach cmd_text in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    loop
      select exists (
        select 1 from pg_policies p
        where p.schemaname = all_pol.schemaname
          and p.tablename = all_pol.tablename
          and p.cmd = cmd_text
          and p.permissive = 'PERMISSIVE'
      ) into has_user;

      if not has_user then
        new_policy_name := all_pol.policyname || '_' || lower(cmd_text);

        if cmd_text = 'INSERT' then
          execute format(
            'create policy %I on %I.%I for insert with check (%s)',
            new_policy_name, all_pol.schemaname, all_pol.tablename, effective_check
          );

        elsif cmd_text = 'UPDATE' then
          execute format(
            'create policy %I on %I.%I for update using (%s) with check (%s)',
            new_policy_name, all_pol.schemaname, all_pol.tablename,
            all_pol.qual, effective_check
          );

        else  -- SELECT or DELETE: USING only
          execute format(
            'create policy %I on %I.%I for %s using (%s)',
            new_policy_name, all_pol.schemaname, all_pol.tablename,
            cmd_text, all_pol.qual
          );
        end if;

        creates := creates + 1;
      end if;
    end loop;

    -- Step 3: drop the cmd=ALL policy now that it has been split out.
    execute format(
      'drop policy %I on %I.%I',
      all_pol.policyname, all_pol.schemaname, all_pol.tablename
    );
    drops := drops + 1;
  end loop;

  raise notice 'Split all-cmd policies: rewrote=%, created=%, dropped=%',
    rewrites, creates, drops;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-checks
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare
  remaining_overlaps int;
  bad_table text;
  remaining_all_cmd int;
begin
  -- (a) every touched table still has ≥1 permissive policy somewhere — would
  -- catch any case where the all-cmd policy was the only protection.
  select c.relname into bad_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = true
    and c.relname in (
      'availability_exceptions', 'blog_posts', 'communication_preferences',
      'contact_submissions', 'conversations', 'homework_assignments',
      'legal_document_versions', 'legal_documents', 'messages', 'packages',
      'refund_policies', 'services', 'session_notes_history',
      'session_presence_events', 'sessions', 'site_announcements',
      'site_blog_categories', 'site_faqs', 'site_features', 'student_credits',
      'student_packages', 'student_progress', 'teacher_availability',
      'teacher_ijaza', 'teacher_languages', 'teacher_recitations',
      'teacher_specialties'
    )
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = c.relname
        and p.permissive = 'PERMISSIVE'
    )
  limit 1;

  if bad_table is not null then
    raise exception 'Post-check: table public.% has no permissive policies left after split', bad_table;
  end if;

  -- (b) zero cmd=ALL permissive policies should remain on these 27 tables.
  select count(*) into remaining_all_cmd
  from pg_policies
  where schemaname = 'public'
    and cmd = 'ALL'
    and permissive = 'PERMISSIVE'
    and tablename in (
      'availability_exceptions', 'blog_posts', 'communication_preferences',
      'contact_submissions', 'conversations', 'homework_assignments',
      'legal_document_versions', 'legal_documents', 'messages', 'packages',
      'refund_policies', 'services', 'session_notes_history',
      'session_presence_events', 'sessions', 'site_announcements',
      'site_blog_categories', 'site_faqs', 'site_features', 'student_credits',
      'student_packages', 'student_progress', 'teacher_availability',
      'teacher_ijaza', 'teacher_languages', 'teacher_recitations',
      'teacher_specialties'
    );

  if remaining_all_cmd > 0 then
    raise exception 'Post-check: % cmd=ALL permissive policies still remain on touched tables', remaining_all_cmd;
  end if;

  -- (c) overlap groups (with ALL expanded to 4 cmds) should be 0 on touched
  -- tables. unnest() can't live inside a CASE expression in PG17, so the
  -- CASE returns an array and unnest is applied to it via LATERAL.
  select count(*) into remaining_overlaps
  from (
    select p.tablename, role, c.effective_cmd
    from pg_policies p
    cross join lateral unnest(p.roles) as role
    cross join lateral (
      select unnest(
        case when p.cmd = 'ALL'
             then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
             else array[p.cmd]
        end
      ) as effective_cmd
    ) c
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and p.tablename in (
        'availability_exceptions', 'blog_posts', 'communication_preferences',
        'contact_submissions', 'conversations', 'homework_assignments',
        'legal_document_versions', 'legal_documents', 'messages', 'packages',
        'refund_policies', 'services', 'session_notes_history',
        'session_presence_events', 'sessions', 'site_announcements',
        'site_blog_categories', 'site_faqs', 'site_features', 'student_credits',
        'student_packages', 'student_progress', 'teacher_availability',
        'teacher_ijaza', 'teacher_languages', 'teacher_recitations',
        'teacher_specialties'
      )
    group by p.tablename, role, c.effective_cmd
    having count(*) > 1
  ) ov;

  if remaining_overlaps > 0 then
    raise exception 'Post-check: % (table, role, cmd) overlap groups still remain on touched tables', remaining_overlaps;
  end if;

  raise notice 'Split-all-cmd migration: 27 tables done, 0 overlaps remain on touched scope';
end $$;

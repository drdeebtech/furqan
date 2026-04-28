-- 20260428095637_hardening_security_definer_and_rls.sql
-- Retire 30 WARN-level Supabase advisor findings in one pass:
--   (a) move btree_gist out of public
--   (b) add SET search_path = public to 9 functions flagged
--       function_search_path_mutable
--   (c) revoke EXECUTE on every SECURITY DEFINER function from anon /
--       authenticated (they're called from triggers and RLS, never via REST)
--   (d) replace dashboard-applied audit_log INSERT policy (WITH CHECK true)
--       with admin/mod-gated policy
--   (e) replace dashboard-applied contact_submissions anon-INSERT policy
--       (WITH CHECK true) with column-pinned predicate
--   (f) drop the broad SELECT policy on storage.objects for teacher-avatars
--       (public CDN reads bypass RLS; the policy only enabled .list())
--
-- Auth-side toggle (HaveIBeenPwned leaked-password protection) is a Supabase
-- dashboard setting and cannot be migrated. Documented in CLAUDE.md.
--
-- Idempotent: every block uses CREATE OR REPLACE, IF EXISTS / IF NOT EXISTS.

-- ────────────────────────────────────────────────────────────────────────────
-- (a) btree_gist → extensions schema
-- ────────────────────────────────────────────────────────────────────────────

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'public'
  ) then
    execute 'alter extension btree_gist set schema extensions';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- (b) Functions: re-emit with SET search_path = public
-- ────────────────────────────────────────────────────────────────────────────

-- redact_pii (already STABLE per 20260428053535)
create or replace function public.redact_pii(payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  redacted jsonb := payload;
  pii_keys text[] := array[
    'email', 'phone', 'parent_email', 'parent_phone', 'whatsapp',
    'date_of_birth', 'avatar_url'
  ];
  k text;
begin
  if payload is null then
    return null;
  end if;
  foreach k in array pii_keys loop
    if redacted ? k then
      redacted := jsonb_set(redacted, array[k], to_jsonb('***REDACTED***'::text));
    end if;
  end loop;
  return redacted;
end;
$$;

-- audit_log_redact_pii_trigger
create or replace function public.audit_log_redact_pii_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.old_data := public.redact_pii(new.old_data);
  new.new_data := public.redact_pii(new.new_data);
  return new;
end;
$$;

-- ensure_teacher_profile (SECURITY DEFINER)
create or replace function public.ensure_teacher_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'teacher'::user_role
     and not exists (select 1 from public.teacher_profiles where teacher_id = new.id)
  then
    insert into public.teacher_profiles (
      teacher_id, specialties, hourly_rate, languages,
      recitation_standards, cv_status, cv_submitted_at,
      is_accepting, is_archived
    ) values (
      new.id, '{}', 20, '{ar}', '{hafs}',
      'approved'::cv_status, now(),
      true, false
    );
  end if;
  return new;
end;
$$;

-- sync_teacher_archive_with_profile (SECURITY DEFINER)
create or replace function public.sync_teacher_archive_with_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = true,
           archived_at = new.deleted_at
     where teacher_id = new.id;
  end if;
  if old.deleted_at is not null and new.deleted_at is null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = false,
           archived_at = null
     where teacher_id = new.id;
  end if;
  return new;
end;
$$;

-- deduct_student_credit
create or replace function public.deduct_student_credit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.status = 'confirmed' and OLD.status = 'pending' then
    with target as (
      select id from student_credits
      where student_id = NEW.student_id
        and (teacher_id is null or teacher_id = NEW.teacher_id)
        and used < total
        and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last
      limit 1
      for update skip locked
    )
    update student_credits
    set used = used + 1
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;

-- restore_student_credit
create or replace function public.restore_student_credit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.status = 'cancelled' and OLD.status = 'confirmed' then
    with target as (
      select id from student_credits
      where student_id = NEW.student_id
        and (teacher_id is null or teacher_id = NEW.teacher_id)
        and used > 0
      order by expires_at asc nulls last
      limit 1
      for update skip locked
    )
    update student_credits
    set used = greatest(used - 1, 0)
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;

-- deduct_student_package
create or replace function public.deduct_student_package()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.status = 'confirmed' and OLD.status = 'pending' then
    with target as (
      select id from student_packages
      where student_id = NEW.student_id
        and status = 'active'
        and sessions_used < sessions_total
        and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last, purchased_at asc
      limit 1
      for update skip locked
    )
    update student_packages
    set sessions_used = sessions_used + 1
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;

-- restore_student_package
create or replace function public.restore_student_package()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.status = 'cancelled' and OLD.status = 'confirmed' then
    with target as (
      select id from student_packages
      where student_id = NEW.student_id
        and sessions_used > 0
      order by expires_at asc nulls last, purchased_at asc
      limit 1
      for update skip locked
    )
    update student_packages
    set sessions_used = greatest(sessions_used - 1, 0)
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;

-- deduct_package_session (RPC helper, plain SQL)
create or replace function public.deduct_package_session(p_package_id uuid)
returns boolean
language sql
set search_path = public
as $$
  update student_packages
  set sessions_used = sessions_used + 1
  where id = p_package_id
    and status = 'active'
    and sessions_used < sessions_total
    and (expires_at is null or expires_at > now())
  returning true;
$$;

-- rls_auto_enable: dashboard-only, body unknown — only adjust the GUC.
-- Wrapped in DO so the migration doesn't fail on environments where the
-- function doesn't exist (e.g. a fresh local DB).
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'alter function public.rls_auto_enable() set search_path = public';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- (c) Revoke EXECUTE on SECURITY DEFINER functions from API roles.
-- These are trigger-internals or RLS-helpers; no /rest/v1/rpc callers exist.
-- Revoking does NOT affect their use inside policies/triggers.
-- ────────────────────────────────────────────────────────────────────────────

revoke execute on function public.is_admin()                          from anon, authenticated;
revoke execute on function public.is_admin_or_mod()                   from anon, authenticated;
revoke execute on function public.is_moderator()                      from anon, authenticated;
revoke execute on function public.handle_new_user()                   from anon, authenticated;
revoke execute on function public.ensure_teacher_profile()            from anon, authenticated;
revoke execute on function public.sync_teacher_archive_with_profile() from anon, authenticated;

-- rls_auto_enable: same conditional pattern
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from anon, authenticated';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- (d) audit_log INSERT — replace WITH CHECK (true) with admin/mod gate.
-- Service-role inserts (loudAction audit hooks) bypass RLS regardless.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "System inserts audit records" on public.audit_log;

create policy audit_log_insert_admin
on public.audit_log
for insert
to authenticated
with check (public.is_admin_or_mod());

-- ────────────────────────────────────────────────────────────────────────────
-- (e) contact_submissions INSERT — column-pinned predicate.
--
-- Live columns (from src/types/supabase.generated.ts + admin/contacts/page.tsx):
--   id, full_name, email, whatsapp, country, student_age,
--   package_interest, message, is_read, is_replied, created_at
--
-- The public form (src/app/(public)/contact/actions.ts) only sets the user-
-- facing fields. is_read / is_replied are admin-only state. created_at has a
-- DB default. The predicate must reject any anon insert that tries to preset
-- admin fields.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists anyone_submit_contact on public.contact_submissions;

create policy contact_submissions_anon_insert
on public.contact_submissions
for insert
to anon
with check (
  coalesce(is_read, false) = false
  and coalesce(is_replied, false) = false
  and length(coalesce(full_name, '')) between 1 and 200
  and length(coalesce(email, '')) between 3 and 320
  and length(coalesce(message, '')) <= 5000
);

-- ────────────────────────────────────────────────────────────────────────────
-- (f) Drop the broad SELECT policy on storage.objects for teacher-avatars.
-- Public CDN reads (/storage/v1/object/public/...) bypass RLS, so dropping
-- this policy doesn't affect avatar rendering — it only blocks the .list()
-- API. Pre-flight grep confirmed no .list() callers in src/.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Public read teacher-avatars" on storage.objects;

-- End of migration.

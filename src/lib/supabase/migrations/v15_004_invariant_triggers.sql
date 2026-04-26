-- v15_004: database-level invariants for teacher_profiles ↔ profiles.role
--
-- The Ahmed Sokar incident: a profiles row had role='teacher' but no
-- teacher_profiles row at all — invisible to admin AND public listings.
-- The app code's INSERT silently failed and nothing caught it.
--
-- These triggers move the invariant from app code to the database itself.
-- After this migration, any code path (admin form, /teach/apply, n8n
-- workflow, raw SQL) that flips a profile to role='teacher' MUST result
-- in a teacher_profiles row. The invariant is enforced regardless of who
-- writes the row or how.
--
-- Two triggers:
--   1. ensure_teacher_profile — AFTER INSERT/UPDATE on profiles.
--      If role becomes 'teacher' and no teacher_profiles row exists,
--      auto-create one with sensible defaults (matches what
--      /admin/users/actions.ts and /teach/apply use today).
--
--   2. archive_teacher_profile_on_soft_delete — AFTER UPDATE on profiles.
--      When deleted_at is set, automatically archive the teacher_profiles
--      row so it disappears from public/student listings.
--      The reverse (clearing deleted_at) un-archives it.

-- ─── 1. Auto-create teacher_profiles on role flip ─────────────────────────
create or replace function public.ensure_teacher_profile()
returns trigger
language plpgsql
security definer
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

drop trigger if exists t_ensure_teacher_profile on public.profiles;
create trigger t_ensure_teacher_profile
  after insert or update of role on public.profiles
  for each row
  execute function public.ensure_teacher_profile();

-- ─── 2. Auto-archive on soft-delete + auto-restore on undelete ────────────
create or replace function public.sync_teacher_archive_with_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Soft-delete: archive the teacher_profiles row.
  if old.deleted_at is null and new.deleted_at is not null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = true,
           archived_at = new.deleted_at
     where teacher_id = new.id;
  end if;

  -- Restore: un-archive.
  if old.deleted_at is not null and new.deleted_at is null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = false,
           archived_at = null
     where teacher_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists t_sync_teacher_archive on public.profiles;
create trigger t_sync_teacher_archive
  after update of deleted_at on public.profiles
  for each row
  execute function public.sync_teacher_archive_with_profile();

insert into schema_migrations (version, description)
  values ('v15_004', 'V15.4: DB invariant triggers — auto-create teacher_profiles on role=teacher; auto-archive on soft-delete')
  on conflict do nothing;

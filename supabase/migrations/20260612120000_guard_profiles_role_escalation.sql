-- P0 security fix (spec 012 §1): block non-admin roles[] self-escalation on profiles
--
-- Exploit: any authenticated user could UPDATE profiles SET roles='{admin}'
-- WHERE id = auth.uid() and self-promote. The RLS WITH CHECK policy allows
-- own-row updates, and no trigger prevented roles column changes.
--
-- The privilege is roles[] (what you hold). The scalar role is only the active
-- selection and is already CHECK-bounded by profiles_active_role_in_set
-- (role = ANY(roles)), so guarding role needlessly breaks switchActiveRole.
--
-- Fix: BEFORE UPDATE OF roles trigger raises 42501 if roles[] changed and
-- caller is not admin, not service_role, and not a direct-DB write (NULL JWT).
-- SECURITY DEFINER to call private.is_admin() bypassing this trigger.

create or replace function private.guard_profiles_roles_change()
returns trigger
language plpgsql
security definer
set search_path TO 'public'
as $$
declare
  v_jwt_role text := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
begin
  if new.roles is distinct from old.roles
     and v_jwt_role is not null            -- NULL => direct DB / migration, trusted
     and v_jwt_role <> 'service_role'      -- trusted server actions (admin/users, apply, test-login)
     and not private.is_admin()            -- admin via own session
  then
    raise exception 'only an admin may change roles'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.guard_profiles_roles_change() owner to postgres;

drop trigger if exists t_guard_profiles_role on public.profiles;
drop trigger if exists t_guard_profiles_roles on public.profiles;

create trigger t_guard_profiles_roles
  before update of roles on public.profiles
  for each row
  execute function private.guard_profiles_roles_change();

drop function if exists private.guard_profiles_role_change();

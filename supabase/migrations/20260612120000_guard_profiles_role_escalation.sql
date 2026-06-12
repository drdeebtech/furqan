-- P0 security fix (spec 012 §1): block non-admin role/roles self-escalation on profiles
--
-- Exploit: any authenticated user could UPDATE profiles SET role='admin', roles='{admin}'
-- WHERE id = auth.uid() and self-promote. The RLS WITH CHECK policy allows own-row updates,
-- and no trigger prevented role column changes.
--
-- Fix: BEFORE UPDATE trigger raises 42501 if role or roles changed and caller is not admin.
-- Uses SECURITY DEFINER to call private.is_admin() (which reads profiles bypassing this trigger).

create or replace function private.guard_profiles_role_change()
returns trigger
language plpgsql
security definer
set search_path TO 'public'
as $$
begin
  if (new.role is distinct from old.role
      or new.roles is distinct from old.roles)
     and not private.is_admin()
  then
    raise exception 'only an admin may change role/roles'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function private.guard_profiles_role_change() owner to postgres;

drop trigger if exists t_guard_profiles_role on public.profiles;

create trigger t_guard_profiles_role
  before update on public.profiles
  for each row
  execute function private.guard_profiles_role_change();

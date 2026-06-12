-- 20260515143139_deduct_package_session_mode_return_used_legacy.sql
-- Closes #242.
-- Change deduct_package_session_mode return type from boolean → TABLE so
-- callers can detect when the legacy session_count fallback was used and
-- surface an explicit UI prompt ("This package uses legacy accounting —
-- contact admin to migrate to mode-aware allowances").
--
-- Return shape: TABLE(deducted boolean, used_legacy boolean)
--   deducted   = true if a session was consumed, false if no allowance / inactive
--   used_legacy = true if the private-mode fallback to packages.session_count
--                 was used (package predates session_mode_allowances migration)
--
-- Breaking change to function signature — safe because no application code
-- calls this function yet (Stage 5 has not shipped). Old callers expecting
-- boolean will need updating to consume the first column or use .single().
--
-- Also adds SECURITY DEFINER (was missing; matches deduct_package_session).

-- Must drop first — changing return type requires replacing the function.
drop function if exists deduct_package_session_mode(uuid, text);

create or replace function public.deduct_package_session_mode(
  p_package_id uuid,
  p_mode       text
)
returns table(deducted boolean, used_legacy boolean)
language sql
security definer
set search_path = public
as $$
  with allowance as (
    select
      sp.id,
      coalesce(
        nullif((p.session_mode_allowances ->> p_mode)::int, 0),
        case when p_mode = 'private' then p.session_count else 0 end
      )                                                                    as mode_allowance,
      coalesce((sp.session_mode_used ->> p_mode)::int, 0)                 as mode_used,
      -- is_legacy = private mode falling back to session_count because the
      -- per-mode JSONB allowance is absent or zero (old package definition).
      (
        nullif((p.session_mode_allowances ->> p_mode)::int, 0) is null
        and p_mode = 'private'
      )                                                                    as is_legacy
    from student_packages sp
    join packages p on p.id = sp.package_id
    where sp.id = p_package_id
      and sp.status = 'active'
      and sp.sessions_used < sp.sessions_total
      and (sp.expires_at is null or sp.expires_at > now())
  ),
  updated as (
    update student_packages
    set
      sessions_used      = sessions_used + 1,
      session_mode_used  = jsonb_set(
        session_mode_used,
        array[p_mode],
        to_jsonb(coalesce((session_mode_used ->> p_mode)::int, 0) + 1)
      )
    from allowance a
    where student_packages.id = a.id
      and a.mode_used < a.mode_allowance
    returning a.is_legacy
  )
  select
    exists(select 1 from updated)                        as deducted,
    coalesce((select is_legacy from updated limit 1), false) as used_legacy;
$$;

grant execute on function public.deduct_package_session_mode(uuid, text) to authenticated;
grant execute on function public.deduct_package_session_mode(uuid, text) to service_role;

comment on function public.deduct_package_session_mode(uuid, text) is
  'Atomic mode-aware decrement. Returns (deducted, used_legacy).
   used_legacy=true when a private booking fell back to packages.session_count
   because session_mode_allowances was zero (legacy package). Stage 5 booking
   flow should surface a prompt when used_legacy is true so admin can migrate
   the package to explicit mode allowances.';

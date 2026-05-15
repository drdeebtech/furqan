-- 20260515141100_v_package_effective_status.sql
-- Closes #241.
-- View that derives real-time effective package status from first principles.
-- The student_packages.status column can lag (e.g., remain 'active' after
-- all sessions are consumed). This view is the authoritative read model for
-- package state and is safe to use in dashboards.
--
-- effective_status values:
--   'expired'   — expires_at is in the past (renewal required regardless of balance)
--   'exhausted' — all sessions consumed (sessions_used >= sessions_total)
--   'active'    — has remaining sessions and not yet expired
--
-- Expired check runs before exhausted so a stale-but-expired package shows
-- 'expired', not 'exhausted' — clearer call-to-action for the student.

create or replace view public.v_package_effective_status
with (security_invoker = on)
as
select
  sp.id                                                      as student_package_id,
  sp.student_id,
  sp.package_id,
  sp.payment_id,
  sp.sessions_total,
  sp.sessions_used,
  greatest(sp.sessions_total - sp.sessions_used, 0)::int    as sessions_remaining,
  sp.expires_at,
  sp.purchased_at,
  sp.created_at,
  case
    when sp.expires_at is not null and sp.expires_at <= now() then 'expired'
    when sp.sessions_used >= sp.sessions_total               then 'exhausted'
    else                                                          'active'
  end                                                        as effective_status
from student_packages sp;

grant select on public.v_package_effective_status to authenticated;
grant select on public.v_package_effective_status to service_role;

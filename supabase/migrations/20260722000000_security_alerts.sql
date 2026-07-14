-- 20260722000000_security_alerts.sql
--
-- Security alert ledger for fail-soft intrusion/rejection recording. Expand-only:
-- adds a new append-only table with RLS enabled and service-role INSERT only.

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  email text null,
  attempted_action text not null,
  alert_level text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint security_alerts_alert_level_check
    check (alert_level in ('info', 'warning', 'critical', 'fatal'))
);

alter table public.security_alerts enable row level security;

revoke all on table public.security_alerts from anon, authenticated;
grant insert on table public.security_alerts to service_role;

create policy security_alerts_insert_service_role on public.security_alerts
  for insert to service_role
  with check (true);

create index if not exists idx_security_alerts_created_at
  on public.security_alerts (created_at desc);

create index if not exists idx_security_alerts_attempted_action
  on public.security_alerts (attempted_action);

-- 20260601093925_add_notification_broadcasts.sql
--
-- Audit H7: the admin broadcast action selected every active profile (unbounded)
-- and Promise.all'd notify() over all of them ON THE REQUEST PATH — ~50k rows in
-- memory + ~150k concurrent ops at scale, exhausting the pool / timing out with a
-- partial, non-resumable broadcast.
--
-- Fix: the admin action now enqueues ONE row here and returns immediately;
-- delivery runs off the request path (Next.js after() for an immediate start,
-- plus a dual-auth /api/cron/process-broadcasts drainer for any remainder a
-- large broadcast couldn't finish within the function budget). This table is the
-- queue + the durable record of each broadcast's progress.

create table if not exists public.notification_broadcasts (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('all', 'student', 'teacher')),
  title text not null,
  body text,
  initiated_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  -- cursor so a drainer can resume where after() left off on a huge broadcast
  cursor_after uuid,
  recipients_sent integer not null default 0,
  recipients_failed integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Drainer lookup: pending/processing rows oldest-first.
create index if not exists notification_broadcasts_pending_idx
  on public.notification_broadcasts (created_at)
  where status in ('pending', 'processing');

alter table public.notification_broadcasts enable row level security;

-- Admin-only (read for the recent-broadcasts list + write). The service-role
-- client (drainer / dispatcher) bypasses RLS.
create policy notification_broadcasts_admin on public.notification_broadcasts
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

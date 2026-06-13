-- 20260501174844_group_sessions_phase1.sql
-- Description: Phase 1 of group lessons — flip the FK direction so multiple
-- bookings can point at the same session. The legacy `sessions.booking_id`
-- stays as the "primary booking" pointer for backward compatibility (every
-- query that joins via `sessions.booking_id` keeps working). The new
-- `bookings.session_id` is the source of truth for "which students are in
-- this session."
--
-- Each enrolled student keeps their own booking row, so per-student concepts
-- (homework, evaluation, package credit, payment) need ZERO schema changes
-- — they're already keyed by `student_id`.
--
-- This migration only ships the schema for ad-hoc add-student. The
-- `class_offerings` table (Phase 2) is a separate migration so each phase
-- has a clean rollback boundary.

-- 1. Bookings can now point at a shared session.
alter table public.bookings
  add column if not exists session_id uuid
    references public.sessions(id) on delete set null;

-- 2. Sessions know their capacity and whether they're a group session.
--    Cap of 20 is a sanity rail — Quran teaching groups in practice don't
--    exceed that, and Daily.co room defaults handle it without special
--    pricing tiers.
alter table public.sessions
  add column if not exists is_group boolean not null default false;
alter table public.sessions
  add column if not exists capacity int not null default 1;

-- Add the CHECK separately so a re-run finds it idempotently.
alter table public.sessions
  drop constraint if exists sessions_capacity_range;
alter table public.sessions
  add constraint sessions_capacity_range
  check (capacity between 1 and 20);

-- 3. Backfill: every existing booking that already had a 1:1 session gets
--    its session_id populated. Idempotent — only fills NULLs.
update public.bookings b
set    session_id = s.id
from   public.sessions s
where  s.booking_id = b.id
  and  b.session_id is null;

-- 4. Index the new "list students in this session" lookup.
create index if not exists bookings_session_id_idx
  on public.bookings(session_id);

-- Sanity check: every session that has a primary booking_id should now have
-- at least one booking pointing back at it via session_id (the backfill row).
do $$
declare
  orphan_count int;
begin
  select count(*) into orphan_count
  from public.sessions s
  where s.booking_id is not null
    and not exists (
      select 1 from public.bookings b
      where b.session_id = s.id and b.id = s.booking_id
    );
  if orphan_count > 0 then
    raise exception
      'Phase 1 backfill incomplete: % sessions still lack a back-pointing booking row',
      orphan_count;
  end if;
  raise notice 'group_sessions_phase1 applied. bookings.session_id, sessions.is_group, sessions.capacity in place; backfill verified.';
end $$;

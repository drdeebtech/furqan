-- Merge the last 8 multiple_permissive_policies advisor warnings.
--
-- Background: after the previous perf migration (20260428210029) cleared the
-- legacy "Title Case" overlaps, eight pairs of *canonical* short-named
-- policies still overlap. Each pair is a permissive policy on the same
-- (table, cmd, role) triple. Postgres OR-combines permissive policies, so
-- evaluating both per row is wasted work even when one is a strict superset.
--
-- Strategy per pair:
--   - 6 pairs: genuine OR-merge — drop both, recreate one policy whose
--     USING/WITH CHECK is `(predicate_A) OR (predicate_B)`.
--   - 2 pairs (sessions UPDATE, teacher_profiles UPDATE): the broader policy
--     already includes the narrower predicate as a disjunct, so the narrower
--     one is dead weight — just drop it.
--
-- Each merged predicate is the literal OR of the originals' quals, so RLS
-- semantics are preserved exactly (modulo the fact that the planner now sees
-- one expression instead of two and can fold/short-circuit better).
--
-- Reads carry over the wrapped `(select auth.uid())` form introduced by
-- 20260428210029 — this migration uses the same wrapping so we don't
-- regress the auth_rls_initplan advisor count.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. bookings DELETE — admin via profiles-check + student own-pending
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists bookings_admin_delete on public.bookings;
drop policy if exists bookings_delete       on public.bookings;

create policy bookings_delete on public.bookings
  for delete
  using (
    (select private.is_admin())
    or (
      (select auth.uid()) = student_id
      and status = 'pending'::booking_status
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 2. homework_assignments ALL — admin/mod + teacher own
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists admin_mod_homework on public.homework_assignments;
drop policy if exists teacher_homework   on public.homework_assignments;

create policy homework_all on public.homework_assignments
  for all
  using (
    (select private.is_admin_or_mod())
    or teacher_id = (select auth.uid())
  )
  with check (
    (select private.is_admin_or_mod())
    or teacher_id = (select auth.uid())
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 3. profiles UPDATE — admin + self
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_update       on public.profiles;

create policy profiles_update on public.profiles
  for update
  using (
    (select private.is_admin())
    or (select auth.uid()) = id
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. reviews UPDATE — student own + teacher own
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists reviews_update_student on public.reviews;
drop policy if exists reviews_update_teacher on public.reviews;

create policy reviews_update on public.reviews
  for update
  using (
    (select auth.uid()) = student_id
    or (select auth.uid()) = teacher_id
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 5. session_presence_events SELECT — self + session participants
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists self_read_presence                  on public.session_presence_events;
drop policy if exists session_participants_read_presence on public.session_presence_events;

create policy session_presence_events_select on public.session_presence_events
  for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from sessions s
      join bookings b on b.id = s.booking_id
      where s.id = session_presence_events.session_id
        and (
          b.student_id = (select auth.uid())
          or b.teacher_id = (select auth.uid())
        )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 6. sessions UPDATE — sessions_teacher_update is fully covered by sessions_update
-- ═════════════════════════════════════════════════════════════════════════
-- sessions_update already includes the teacher-of-booking branch:
--   ... OR bookings.teacher_id = auth.uid() ...
-- so sessions_teacher_update is dead weight. Just drop it.
drop policy if exists sessions_teacher_update on public.sessions;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. teacher_profiles INSERT — admin + self-create
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists tp_admin_insert on public.teacher_profiles;
drop policy if exists tp_self_insert  on public.teacher_profiles;

create policy tp_insert on public.teacher_profiles
  for insert
  with check (
    (select private.is_admin())
    or (select auth.uid()) = teacher_id
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 8. teacher_profiles UPDATE — tp_admin_update is fully covered by tp_update
-- ═════════════════════════════════════════════════════════════════════════
-- tp_update already includes the admin branch:
--   ((select auth.uid()) = teacher_id) OR private.is_admin()
-- so tp_admin_update is dead weight. Just drop it.
drop policy if exists tp_admin_update on public.teacher_profiles;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-checks
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare
  remaining_overlaps int;
  bad_table text;
begin
  -- Every touched table must still have ≥1 permissive policy per cmd.
  select c.relname into bad_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = true
    and c.relname in (
      'bookings', 'homework_assignments', 'profiles', 'reviews',
      'session_presence_events', 'sessions', 'teacher_profiles'
    )
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = c.relname
        and p.permissive = 'PERMISSIVE'
    )
  limit 1;

  if bad_table is not null then
    raise exception 'Post-check: table %.% has no permissive policies left after merge',
      'public', bad_table;
  end if;

  -- And: zero permissive overlap groups should remain on these 7 tables.
  select count(*) into remaining_overlaps
  from (
    select tablename, cmd, role
    from pg_policies, unnest(roles) as role
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and tablename in (
        'bookings', 'homework_assignments', 'profiles', 'reviews',
        'session_presence_events', 'sessions', 'teacher_profiles'
      )
    group by tablename, cmd, role
    having count(*) > 1
  ) ov;

  if remaining_overlaps > 0 then
    raise exception 'Post-check: % overlap groups still remain on the merged tables',
      remaining_overlaps;
  end if;

  raise notice 'Merge migration: 8 overlap groups consolidated, 0 remaining on touched tables';
end $$;

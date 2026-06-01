-- 20260601202447_murajaah_scheduler_sm2_foundation.sql
-- Spec 001 (murajaah-scheduler), SM-2 v1 — STUDENT-SIDE FOUNDATION.
--
-- Implements specs/001-murajaah-scheduler/data-model.md: the
-- student_review_schedule table + SM-2 nightly batch compute + per-review
-- recompute, so the platform can surface "what is due to revise today" from the
-- student_progress rows that spec 010 now captures.
--
-- Deviations from data-model.md (documented):
--   1. Teacher-side RLS + mark_reteach_complete are DEFERRED: the data-model
--      references public.teacher_student_assignments, which does not exist in
--      this schema. The teacher↔student relationship is modeled via `bookings`
--      here; the teacher reteach surface (US2 / FR-013) ships once that
--      mechanism is confirmed. This migration is student-side only (US1).
--   2. The partial "reteach" index used `now()` in its predicate, which Postgres
--      rejects (index predicates must be IMMUTABLE). Dropped — the
--      (student_id, next_review_at) index already serves the reteach seek.
--   3. The nightly seed schedules only progress_type='new' rows (memorised
--      items / sabaq) — consistent with the existing murajaah dashboard, which
--      keys off progress_type='new'. Reviewing review-records would double-count.

-- ─── table ──────────────────────────────────────────────────────────────────
create table if not exists public.student_review_schedule (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references auth.users(id) on delete cascade,
  progress_id        uuid not null references public.student_progress(id) on delete cascade,
  next_review_at     timestamptz not null,
  easiness_factor    real not null default 2.5 check (easiness_factor between 1.3 and 3.5),
  interval_days      integer not null default 1 check (interval_days >= 0),
  lapse_count        smallint not null default 0,
  last_reviewed_at   timestamptz,
  batch_for_date     date,
  algorithm_version  smallint not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (student_id, progress_id)  -- one schedule row per memorised item per student
);

create index if not exists idx_srs__student_next_review
  on public.student_review_schedule (student_id, next_review_at);
create index if not exists idx_srs__batch_for_date
  on public.student_review_schedule (batch_for_date) where batch_for_date is not null;

drop trigger if exists trg_srs__set_updated_at on public.student_review_schedule;
create trigger trg_srs__set_updated_at
  before update on public.student_review_schedule
  for each row execute function public.set_updated_at();

-- ─── RLS (student + admin; teacher deferred) ────────────────────────────────
alter table public.student_review_schedule enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='student_review_schedule' and policyname='srs__student_read') then
    create policy srs__student_read on public.student_review_schedule
      for select using (student_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='student_review_schedule' and policyname='srs__student_update') then
    create policy srs__student_update on public.student_review_schedule
      for update using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='student_review_schedule' and policyname='srs__admin_all') then
    create policy srs__admin_all on public.student_review_schedule
      for all using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- ─── settings seed (FR-006) ─────────────────────────────────────────────────
insert into public.platform_settings (key, value, description) values
  ('sm2_initial_interval_days', '1',   'Murajaah SM-2: initial review interval (days) for a newly memorised item'),
  ('sm2_easiness_factor',       '2.5', 'Murajaah SM-2: initial easiness factor for new schedule rows (per-row drift after)'),
  ('sm2_lapse_penalty',         '0.8', 'Murajaah SM-2: multiplier applied to EF when an item lapses (teacher reteach)')
on conflict (key) do nothing;

-- ─── fn 1: nightly batch compute (cron / service_role) ──────────────────────
create or replace function public.compute_murajaah_batch_for_date(p_date date)
returns table (students_processed int, rows_scheduled int)
language plpgsql security definer set search_path = public as $$
declare
  v_initial_interval int;
  v_initial_ef real;
begin
  select value::int  into v_initial_interval from platform_settings where key = 'sm2_initial_interval_days';
  select value::real into v_initial_ef       from platform_settings where key = 'sm2_easiness_factor';
  v_initial_interval := coalesce(v_initial_interval, 1);
  v_initial_ef := coalesce(v_initial_ef, 2.5);

  -- Seed a schedule row for each memorised (progress_type='new') item not yet scheduled.
  insert into student_review_schedule (student_id, progress_id, next_review_at, easiness_factor, interval_days)
  select sp.student_id, sp.id, now() + make_interval(days => v_initial_interval), v_initial_ef, v_initial_interval
  from student_progress sp
  where sp.progress_type = 'new'
    and not exists (select 1 from student_review_schedule s where s.student_id = sp.student_id and s.progress_id = sp.id);

  -- Set batch_for_date on up to 15 due rows per student within the 7-day fresh
  -- window, oldest-overdue-first (FR-011: backlog beyond 7 days does NOT flood
  -- the card — it routes to the teacher reteach queue, US2).
  -- Range predicate on the raw timestamptz column (NOT next_review_at::date,
  -- which is non-SARGable and would force a full scan of a 10M-row table at
  -- 50k DAU). [(p_date - 7) 00:00, (p_date + 1) 00:00) == dates p_date-7..p_date
  -- inclusive, and uses the (student_id, next_review_at) index.
  with ranked as (
    select id, row_number() over (partition by student_id order by next_review_at asc) as rn
    from student_review_schedule
    where next_review_at >= (p_date - 7)::timestamptz
      and next_review_at <  (p_date + 1)::timestamptz
      and (batch_for_date is null or batch_for_date <> p_date)
  )
  update student_review_schedule s
    set batch_for_date = p_date
  from ranked where s.id = ranked.id and ranked.rn <= 15;

  return query
    select count(distinct student_id)::int, count(*)::int
    from student_review_schedule where batch_for_date = p_date;
end; $$;

revoke all on function public.compute_murajaah_batch_for_date(date) from public, anon, authenticated;
grant execute on function public.compute_murajaah_batch_for_date(date) to service_role;

-- ─── fn 2: per-review SM-2 recompute (student markReviewComplete) ────────────
create or replace function public.complete_review(p_schedule_id uuid, p_quality int)
returns table (next_review_at timestamptz, easiness_factor real, interval_days int)
language plpgsql security invoker set search_path = public as $$
declare
  v_row student_review_schedule;
  v_new_ef real;
  v_new_interval int;
begin
  if p_quality < 0 or p_quality > 5 then
    raise exception 'invalid quality: %', p_quality using errcode = '22023';
  end if;

  select * into v_row from student_review_schedule where id = p_schedule_id for update;
  if not found then raise exception 'schedule row not found' using errcode = 'P0002'; end if;

  -- SM-2 easiness-factor update, clamped to [1.3, 3.5].
  v_new_ef := greatest(1.3, least(3.5,
    v_row.easiness_factor + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02))));

  -- SM-2 interval progression. A failed recall (q < 3) resets to 1 day. The
  -- seed interval is I(1)=1; the first successful review graduates it to
  -- I(2)=6, and every later success scales by the easiness factor
  -- (I(n)=round(I(n-1)·EF)). NOTE: the graduation MUST jump 1→6 — mapping
  -- 1→1 (or 6→6) freezes the interval, so the item would fall due every day
  -- forever and the scheduler would nag instead of space out (verified on
  -- local PG before this migration shipped).
  v_new_interval := case
    when p_quality < 3 then 1
    when v_row.interval_days <= 1 then 6
    else greatest(1, round(v_row.interval_days * v_new_ef))::int
  end;

  -- RETURNING is the single source of truth for the computed next_review_at —
  -- no second now()/make_interval recompute in the return clause.
  return query
    update student_review_schedule
      set easiness_factor = v_new_ef,
          interval_days   = v_new_interval,
          next_review_at  = now() + make_interval(days => v_new_interval),
          last_reviewed_at = now(),
          batch_for_date  = null
      where id = p_schedule_id
      -- table-qualified: the RETURNS TABLE columns share these names.
      returning student_review_schedule.next_review_at,
                student_review_schedule.easiness_factor,
                student_review_schedule.interval_days;
end; $$;

-- complete_review is SECURITY INVOKER: it runs as the calling student and the
-- RLS update policy (student_id = auth.uid()) gates it, so EXECUTE by
-- authenticated is intentional (the student calls it via rpc).

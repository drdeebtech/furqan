# Data Model — Murajaah Scheduler

Phase 1 of `/speckit.plan`. Defines the new `student_review_schedule` table, its indexes, RLS policies, and the three Postgres functions that mediate access.

---

## New table: `student_review_schedule`

```sql
create table public.student_review_schedule (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references auth.users(id) on delete cascade,
  progress_id        uuid not null references public.student_progress(id) on delete cascade,

  -- SM-2 state (per-row, drifts with reviews)
  next_review_at     timestamptz not null,
  easiness_factor    real not null default 2.5 check (easiness_factor between 1.3 and 3.5),
  interval_days      integer not null default 1 check (interval_days >= 0),
  lapse_count        smallint not null default 0,
  last_reviewed_at   timestamptz,

  -- Cron cache (FR-012)
  batch_for_date     date,                          -- the date this row is scheduled into the daily card; NULL if not currently in any batch

  -- Algorithm provenance (FR-010)
  algorithm_version  smallint not null default 1,   -- bumped only when SM-2 itself is replaced; admin EF tunes do NOT bump this

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (student_id, progress_id),                 -- one schedule row per memorised item per student
  unique (student_id, progress_id, batch_for_date)  -- prevents duplicate batch inserts (idempotency)
);

create index idx_student_review_schedule__student_next_review
  on public.student_review_schedule (student_id, next_review_at);

create index idx_student_review_schedule__batch_for_date
  on public.student_review_schedule (batch_for_date)
  where batch_for_date is not null;

create index idx_student_review_schedule__teacher_reteach
  on public.student_review_schedule (student_id, next_review_at)
  where next_review_at < now() - interval '7 days';

create trigger trg_student_review_schedule__set_updated_at
  before update on public.student_review_schedule
  for each row execute function public.set_updated_at();
```

**Why these indexes** (per research.md "Index strategy"):

| Index | Drives query | Frequency |
|---|---|---|
| `(student_id, next_review_at)` | nightly cron's per-student fresh-window seek | once per student per night |
| `(batch_for_date)` partial | dashboard SELECT for today's batch | 250k reads/day at 50k DAU |
| `(student_id, next_review_at) WHERE next_review_at < now() - 7 days` | teacher reteach queue | low-volume; per teacher panel hit |

The partial index on the reteach queue is the cheapest way to keep teacher-side queries fast without polluting the primary index. As of writing, this kind of partial index requires `now() - interval '7 days'` to be folded into the predicate at index-build time — not literal `now()` (which would make it non-immutable). Implementation note for the migration: use `pg_catalog.now()` or recompute the predicate as `next_review_at < (current_date - interval '7 days')` if Supabase's planner needs it.

---

## RLS policies

```sql
alter table public.student_review_schedule enable row level security;

-- Students see only their own rows
create policy student_review_schedule__student_read
  on public.student_review_schedule
  for select
  using (student_id = (select auth.uid()));

-- Students can update their own rows (the markReviewComplete server action does this via SECURITY INVOKER)
create policy student_review_schedule__student_update
  on public.student_review_schedule
  for update
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

-- Teachers see rows of students they're assigned to teach
create policy student_review_schedule__teacher_read
  on public.student_review_schedule
  for select
  using (
    exists (
      select 1
      from public.teacher_student_assignments tsa
      where tsa.teacher_id = (select auth.uid())
        and tsa.student_id = student_review_schedule.student_id
    )
  );

-- Teachers can update lapse_count + EF on their students' rows (the markReteachComplete server action)
create policy student_review_schedule__teacher_update
  on public.student_review_schedule
  for update
  using (
    exists (
      select 1
      from public.teacher_student_assignments tsa
      where tsa.teacher_id = (select auth.uid())
        and tsa.student_id = student_review_schedule.student_id
    )
  );

-- Admins (via existing is_admin() function) get full access
create policy student_review_schedule__admin_all
  on public.student_review_schedule
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- The cron user (service-role) is RLS-bypassed by default; no policy needed.
```

**RLS at 50k scale**: every predicate references `student_id` (the indexed column) directly. Postgres's planner pushes the RLS predicate into the WHERE clause and uses the `(student_id, next_review_at)` index. No sequential scans at 10M-row scale. ✅ Constitution flag #7 satisfied.

---

## Postgres functions

### 1. `compute_murajaah_batch_for_date(p_date date)`

**Owner**: cron (n8n nightly workflow). Idempotent within `p_date`.

**Pseudocode** (full implementation in migration file):

```sql
create or replace function public.compute_murajaah_batch_for_date(p_date date)
returns table (students_processed int, rows_scheduled int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial_interval int;
  v_initial_ef       real;
  v_algorithm_version smallint := 1;
begin
  -- Read tunables from platform_settings (one read for the whole run)
  select (value::int) into v_initial_interval
    from public.platform_settings where key = 'sm2_initial_interval_days';
  select (value::real) into v_initial_ef
    from public.platform_settings where key = 'sm2_easiness_factor';

  -- For each (student, progress) pair without a schedule row yet, seed one.
  insert into public.student_review_schedule
    (student_id, progress_id, next_review_at, easiness_factor, interval_days, algorithm_version)
  select sp.student_id, sp.id,
         now() + (v_initial_interval || ' days')::interval,
         v_initial_ef, v_initial_interval, v_algorithm_version
  from public.student_progress sp
  where not exists (
    select 1 from public.student_review_schedule s
    where s.student_id = sp.student_id and s.progress_id = sp.id
  );

  -- For each student, set batch_for_date on up to 15 rows in the fresh window
  -- (per FR-011: next_review_at within last 7 days, oldest-overdue-first).
  with ranked as (
    select id,
           row_number() over (
             partition by student_id
             order by next_review_at asc
           ) as rn
    from public.student_review_schedule
    where next_review_at <= p_date + interval '0 days'
      and next_review_at >= p_date - interval '7 days'
      and (batch_for_date is null or batch_for_date <> p_date)
  )
  update public.student_review_schedule
    set batch_for_date = p_date
  from ranked
  where student_review_schedule.id = ranked.id and ranked.rn <= 15;

  return query
    select count(distinct student_id)::int as students_processed,
           count(*)::int as rows_scheduled
    from public.student_review_schedule
    where batch_for_date = p_date;
end;
$$;

revoke all on function public.compute_murajaah_batch_for_date(date) from public, anon, authenticated;
grant execute on function public.compute_murajaah_batch_for_date(date) to service_role;
```

**Atomicity**: the whole function runs in one implicit transaction. If any step fails, no batch rows for `p_date` exist; n8n retries safely (the unique constraint on `(student_id, progress_id, batch_for_date)` prevents duplicates).

### 2. `complete_review(p_schedule_id uuid, p_quality int)`

**Owner**: `markReviewComplete` server action (student role). Atomic per-row.

```sql
create or replace function public.complete_review(p_schedule_id uuid, p_quality int)
returns table (next_review_at timestamptz, easiness_factor real, interval_days int)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_new_ef real;
  v_new_interval int;
begin
  if p_quality < 0 or p_quality > 5 then
    raise exception 'Invalid quality: %', p_quality;
  end if;

  select * into v_row from public.student_review_schedule where id = p_schedule_id for update;
  if not found then
    raise exception 'schedule row not found';
  end if;

  -- SM-2 EF update: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q)*0.02))
  v_new_ef := greatest(1.3, least(3.5,
    v_row.easiness_factor + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02))
  ));

  -- SM-2 interval update
  v_new_interval := case
    when v_row.lapse_count = 0 and v_row.interval_days <= 1 then 1
    when v_row.lapse_count = 0 and v_row.interval_days <= 6 then 6
    else greatest(1, round(v_row.interval_days * v_new_ef))::int
  end;

  update public.student_review_schedule
    set easiness_factor = v_new_ef,
        interval_days   = v_new_interval,
        next_review_at  = now() + (v_new_interval || ' days')::interval,
        last_reviewed_at = now(),
        batch_for_date  = null  -- removed from today's card
    where id = p_schedule_id;

  return query select
    now() + (v_new_interval || ' days')::interval as next_review_at,
    v_new_ef as easiness_factor,
    v_new_interval as interval_days;
end;
$$;
```

### 3. `mark_reteach_complete(p_schedule_id uuid)`

**Owner**: `markReteachComplete` server action (teacher role). Atomic per-row.

```sql
create or replace function public.mark_reteach_complete(p_schedule_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lapse_penalty real;
begin
  select (value::real) into v_lapse_penalty
    from public.platform_settings where key = 'sm2_lapse_penalty';

  update public.student_review_schedule
    set lapse_count    = lapse_count + 1,
        easiness_factor = greatest(1.3, easiness_factor * v_lapse_penalty),
        interval_days  = 1,
        next_review_at = now() + interval '1 day',
        last_reviewed_at = now(),
        batch_for_date = null
    where id = p_schedule_id;

  if not found then
    raise exception 'schedule row not found';
  end if;
end;
$$;
```

---

## Migration outline

File: `supabase/migrations/20260509000000_murajaah_scheduler.sql`

Sections:
1. `create table public.student_review_schedule (...)` (above).
2. Indexes (3 listed above).
3. Trigger for `updated_at` (reuses existing `set_updated_at()`).
4. RLS policies (5 listed above).
5. Postgres functions (3 listed above).
6. Seed `platform_settings` rows: `sm2_initial_interval_days=1`, `sm2_easiness_factor=2.5`, `sm2_lapse_penalty=0.8`.
7. Comment block citing this spec and ADR-0004's Postgres-function pattern.

The migration runs via the `Supabase Migrate` GitHub Action (per CLAUDE.md "Database Migrations Policy"). Dry-run in PR; applied on merge to `main`.

-- 20260502114946_courses_platform_ownership.sql
-- Add platform-owned ownership mode to recorded courses.
--
-- Today every course must belong to a teacher (`courses.teacher_id NOT NULL`)
-- and revenue is implicitly shared 70/30 with that teacher. We need a second
-- mode where staff upload courses that belong to the platform itself: zero
-- payout to any teacher, 100% of revenue stays with the platform.
--
-- Approach: relax `teacher_id` to nullable, add a categorical `ownership`
-- column ('platform' | 'teacher') and a `teacher_revenue_share_bps` column
-- in basis points (0–10000). A single CHECK constraint binds the three so
-- it is impossible to have a platform-owned course with a teacher_id, or a
-- teacher-owned course without one.
--
-- RLS: existing policies compare `teacher_id = auth.uid()`. Postgres treats
-- `null = uuid` as `null`, which is non-true under RLS — so platform rows
-- (teacher_id IS NULL) are automatically invisible to teachers without any
-- policy rewrite. We do not modify courses_select / _update / _delete.

begin;

-- 1. Relax NOT NULL on teacher_id.
alter table public.courses
  alter column teacher_id drop not null;

-- 2. Ownership flag with safe default for backfill.
alter table public.courses
  add column if not exists ownership text not null default 'teacher'
    check (ownership in ('platform','teacher'));

-- 3. Per-course revenue share for the teacher, in basis points.
--    7000 bps = 70% (current implicit default for teacher courses).
--    Always 0 for platform-owned rows (enforced by the CHECK below).
alter table public.courses
  add column if not exists teacher_revenue_share_bps int not null default 7000
    check (teacher_revenue_share_bps between 0 and 10000);

-- 4. Single source of truth: the three columns must agree.
alter table public.courses
  drop constraint if exists courses_ownership_consistent;

alter table public.courses
  add constraint courses_ownership_consistent check (
    (ownership = 'platform' and teacher_id is null and teacher_revenue_share_bps = 0)
    or (ownership = 'teacher' and teacher_id is not null)
  );

-- 5. Partial index to make the public "Platform Originals" listing fast.
create index if not exists idx_courses_platform_owned
  on public.courses (status, published_at desc)
  where ownership = 'platform' and deleted_at is null;

-- 6. Post-checks — fail fast on schema bugs.
do $$
declare
  bad_rows int;
  ownership_default text;
  teacher_id_nullable boolean;
begin
  -- Every existing row must satisfy the new invariant.
  select count(*) into bad_rows
  from public.courses
  where not (
    (ownership = 'platform' and teacher_id is null and teacher_revenue_share_bps = 0)
    or (ownership = 'teacher' and teacher_id is not null)
  );
  if bad_rows > 0 then
    raise exception 'courses_platform_ownership: % existing rows violate the new invariant', bad_rows;
  end if;

  -- teacher_id must now be nullable.
  select is_nullable = 'YES' into teacher_id_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'courses' and column_name = 'teacher_id';
  if not teacher_id_nullable then
    raise exception 'courses_platform_ownership: teacher_id is still NOT NULL';
  end if;

  -- Default for ownership must be 'teacher' so future plain INSERTs are unambiguous.
  select column_default into ownership_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'courses' and column_name = 'ownership';
  if ownership_default is null or position('teacher' in ownership_default) = 0 then
    raise exception 'courses_platform_ownership: ownership default is not ''teacher'' (got %)', ownership_default;
  end if;

  raise notice 'courses_platform_ownership: schema invariants verified.';
end $$;

commit;

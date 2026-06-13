-- 20260604143211_teacher_scale_rpcs_and_indexes.sql
--
-- PR2 — Teacher dashboard scale: RPCs + indexes
--
-- Problem: Five call sites each fetch ALL of a teacher's bookings (no date/limit)
-- just to collect DISTINCT student_ids in JavaScript. At 50k DAU with large
-- rosters this is an unbounded row transfer on every render.
--
-- Also, the RLS teacher-read/write predicates on student_progress filter by
-- teacher_id, but no index backed that predicate (only idx_progress_student on
-- student_id). And roster_recent_evaluations orders by evaluation_date DESC with
-- a teacher_id = ? filter, but the only teacher index on session_evaluations is
-- (teacher_id, created_at DESC) — a separate column that forces a per-query sort.
--
-- Fixes:
--   S1: teacher_distinct_students(p_teacher_id) RPC — single indexed DISTINCT
--       scan; collapses 5 unbounded bookings fetches.
--   S3: idx_progress_teacher on student_progress(teacher_id, created_at DESC)
--   S4: idx_eval_teacher_evaldate on session_evaluations(teacher_id, evaluation_date DESC)
--   S5: teacher_at_risk_students(p_teacher_id, p_limit) RPC — pushes the whole
--       bookings→retention_signals→profiles join + ORDER BY + LIMIT to Postgres.
--
-- All RPCs: SECURITY INVOKER (caller's RLS still gates rows), STABLE,
-- search_path='', granted to authenticated + service_role.

-- ─── indexes ─────────────────────────────────────────────────────────────────

-- S3: teacher_id + created_at covers RLS teacher-read/write predicates and the
-- window-function queries in roster_recent_progress that join student_ids from
-- this teacher. Mirrors the existing idx_eval_teacher on session_evaluations.
create index if not exists idx_progress_teacher
  on public.student_progress (teacher_id, created_at desc);

-- S4: evaluation_date is the ORDER BY column used by roster_recent_evaluations
-- (window function). Without this index Postgres sorts every matched row per
-- teacher per call. evaluation_date is a NOT NULL date column (≠ created_at),
-- so the existing idx_eval_teacher(teacher_id, created_at desc) does not help.
create index if not exists idx_eval_teacher_evaldate
  on public.session_evaluations (teacher_id, evaluation_date desc);

-- ─── S1: teacher_distinct_students ───────────────────────────────────────────
-- Returns every distinct student_id that has at least one booking with
-- p_teacher_id. Replaces five unbounded per-render JS dedup loops:
--   teacher-queries.ts  getTeacherRecitationRoster (L427-435)
--   teacher-queries.ts  getTeacherRosterProgress   (L738-746)
--   students/page.tsx                              (L34-36)
--   dashboard/page.tsx                             (L83)
--   dashboard/at-risk-students.tsx                 (L39-46)
--
-- SECURITY INVOKER: the existing bookings RLS (teacher only sees own rows)
-- already gates results; no need for SECURITY DEFINER here.
create or replace function public.teacher_distinct_students(
  p_teacher_id uuid
)
returns table (student_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct b.student_id
  from   public.bookings b
  where  b.teacher_id = p_teacher_id;
$$;

grant execute on function public.teacher_distinct_students(uuid) to authenticated, service_role;

-- ─── S5: teacher_at_risk_students ────────────────────────────────────────────
-- Replaces the three-step JS aggregation in at-risk-students.tsx:
--   1. bookings → distinct student_ids (now covered by teacher_distinct_students)
--   2. retention_signals filtered by those ids + churn_risk_score ≥ 60
--   3. profiles lookup for names
--   4. rank + limit in JS
--
-- Pushes ORDER BY churn_risk_score DESC LIMIT p_limit to Postgres; the caller
-- just iterates the result set (no JS ranking).
--
-- Returns a RECORD type so the function is independent of a specific table shape
-- and composes cleanly with .returns<AtRiskRow[]>() on the TypeScript side.
create or replace function public.teacher_at_risk_students(
  p_teacher_id uuid,
  p_limit      int  default 5
)
returns table (
  student_id       uuid,
  full_name        text,
  churn_risk_score double precision,
  last_session_at  timestamptz,
  package_remaining int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    rs.student_id,
    coalesce(pr.full_name, '') as full_name,
    rs.churn_risk_score,
    rs.last_session_at::timestamptz,
    rs.package_remaining
  from (
    select distinct b.student_id
    from   public.bookings b
    where  b.teacher_id = p_teacher_id
  ) students
  join public.retention_signals rs
    on  rs.student_id   = students.student_id
    and rs.churn_risk_score >= 60
  left join public.profiles pr
    on  pr.id = rs.student_id
  order by rs.churn_risk_score desc nulls last
  limit p_limit;
$$;

grant execute on function public.teacher_at_risk_students(uuid, int) to authenticated, service_role;

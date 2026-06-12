-- 20260601085830_add_roster_recent_rpcs.sql
--
-- Audit follow-up (deferred from #338): teacher-queries.ts fetched the last-5
-- progress/eval rows per student with an in-memory `.limit(min(N*10,500))` cap
-- (a global cap that can starve a quiet student). Replace with proper
-- window-function RPCs that bound to exactly 5 rows PER student.
--
-- SECURITY INVOKER so the caller's RLS still gates which students' rows are
-- visible (a teacher only sees their own roster), and `returns setof <table>`
-- so the function tracks the table's column types automatically.

-- ─── last-5 'new' progress rows per student ─────────────────────────────────
create or replace function public.roster_recent_progress(p_student_ids uuid[])
returns setof public.student_progress
language sql
stable
security invoker
set search_path = ''
as $$
  select sp.*
  from public.student_progress sp
  where sp.id in (
    select id from (
      select id,
             row_number() over (partition by student_id order by created_at desc) as rn
      from public.student_progress
      where student_id = any(p_student_ids)
        and progress_type = 'new'
    ) ranked
    where ranked.rn <= 5
  )
  order by sp.created_at desc;
$$;

-- ─── last-5 evaluations per student for a given teacher ─────────────────────
create or replace function public.roster_recent_evaluations(
  p_teacher_id uuid,
  p_student_ids uuid[]
)
returns setof public.session_evaluations
language sql
stable
security invoker
set search_path = ''
as $$
  select se.*
  from public.session_evaluations se
  where se.id in (
    select id from (
      select id,
             row_number() over (partition by student_id order by evaluation_date desc) as rn
      from public.session_evaluations
      where teacher_id = p_teacher_id
        and student_id = any(p_student_ids)
    ) ranked
    where ranked.rn <= 5
  )
  order by se.evaluation_date desc;
$$;

grant execute on function public.roster_recent_progress(uuid[]) to authenticated, service_role;
grant execute on function public.roster_recent_evaluations(uuid, uuid[]) to authenticated, service_role;

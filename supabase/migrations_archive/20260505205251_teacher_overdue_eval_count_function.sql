-- 20260505205251_teacher_overdue_eval_count_function.sql
-- Description: Adds public.get_teacher_overdue_eval_count(uuid) RPC.
--
-- Replaces the two-step fetch+filter pattern in /teacher/dashboard SSR
-- (and the same pattern in dashboard/actions.ts CONFIRM-booking gate)
-- with a single Postgres `NOT EXISTS` query. PostgREST has no clean
-- NOT EXISTS, so the previous app-side approach was: fetch all
-- old-completed bookings, fetch all evaluations for those students,
-- then filter in JS. With this function the count comes back as a
-- single integer in one round trip.
--
-- Idempotent via CREATE OR REPLACE so re-running this migration is safe.
-- SECURITY INVOKER means RLS on the underlying tables still applies —
-- callers can only count their own teacher's bookings/evaluations.

CREATE OR REPLACE FUNCTION public.get_teacher_overdue_eval_count(p_teacher_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.bookings b
  WHERE b.teacher_id = p_teacher_id
    AND b.status = 'completed'
    AND b.scheduled_at < (NOW() - INTERVAL '7 days')
    AND NOT EXISTS (
      SELECT 1
      FROM public.session_evaluations e
      WHERE e.teacher_id = p_teacher_id
        AND e.student_id = b.student_id
        AND e.created_at > b.scheduled_at
    );
$$;

-- The teacher dashboard calls this from a server action authenticated as
-- the user themselves; granting EXECUTE to `authenticated` lets it run.
-- service_role already bypasses grant checks, so admin-side callers
-- (dashboard/actions.ts CONFIRM-booking gate) work without an extra grant.
GRANT EXECUTE ON FUNCTION public.get_teacher_overdue_eval_count(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_teacher_overdue_eval_count(uuid) IS
  'Returns count of completed bookings older than 7 days that have no follow-up evaluation. Used by /teacher/dashboard action queue and the CONFIRM-booking gate (dashboard/actions.ts) to nudge teachers toward evaluation discipline before the gate hardens 2026-05-19.';

-- 20260601002313_add_murajaah_due_student_ids_rpc.sql
--
-- Audit finding H12: the murajaah-due cron loaded every student_progress row
-- from the last 30 days into memory (no limit), deduped student_ids in JS, then
-- issued a potentially 50k-element .in() over study_log. At 50k users that is a
-- multi-million-row read + a ~1.8MB request URL on every daily run.
--
-- Replace that with a single set-based anti-join that returns the due student
-- ids directly: active in the last 30 days AND no study_log row today. The
-- supporting indexes (student_progress(student_id, created_at),
-- study_log(student_id, started_at)) already exist.
--
-- SECURITY DEFINER + service-role-only: this is called from the cron route via
-- the admin client; it is not exposed to authenticated/anon callers.

create or replace function public.murajaah_due_student_ids(
  p_active_since timestamptz,
  p_today_start timestamptz
)
returns table (student_id uuid)
language sql
security definer
set search_path = ''
as $$
  select distinct sp.student_id
  from public.student_progress sp
  where sp.created_at >= p_active_since
    and not exists (
      select 1
      from public.study_log sl
      where sl.student_id = sp.student_id
        and sl.started_at >= p_today_start
    );
$$;

revoke execute on function public.murajaah_due_student_ids(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.murajaah_due_student_ids(timestamptz, timestamptz) to service_role;

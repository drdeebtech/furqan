-- Atomic auto_send_eligible gate counts (spec 028).
-- Replaces two non-atomic sequential COUNT(*) queries in approveReview that could
-- drift under concurrent approvals/rejections. Single statement → single snapshot.
--
-- security definer: ai_output_review is admin-only under RLS, but the service-role
-- client calling this from the admin server action needs the aggregate regardless.
-- search_path pinned + table qualified to harden the security definer against
-- search_path injection. Revoke EXECUTE from anon so a leaked anon key cannot
-- probe aggregate approval counts (authenticated/service_role retain via PUBLIC).

create or replace function public.ai_review_gate(p_workflow_name text)
returns table(approved_count bigint, total_reviewed bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where status = 'approved')                as approved_count,
    count(*) filter (where status in ('approved', 'rejected')) as total_reviewed
  from public.ai_output_review
  where workflow_name = p_workflow_name;
$$;

revoke execute on function public.ai_review_gate(text) from anon;

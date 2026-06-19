-- Spec 023 (م٦) — honor board compute stored function.
--
-- Achievement metric (FR-010 — metric defined here after PO authorization):
--   SUM(pages_reviewed × quality_factor)
--   where quality_factor = COALESCE(quality_rating, 4.0) / 5.0
--
-- Rationale:
--   • pages_reviewed is the direct measure of memorization output per session.
--   • quality_rating (1–5) weights the score; defaulting to 4/5 when unrated
--     avoids penalizing students whose teachers skipped the rating.
--   • Simple, auditable, monotonically increasing with genuine effort.
--
-- Transaction pattern per spec: DELETE existing snapshot for the period, then
-- INSERT fresh snapshot from student_progress. Single round-trip, no N+1.
-- statement_timeout = '30s' surfaces aborts to Sentry without partial commit.
--
-- Security: SECURITY DEFINER so the function can write honor_board_entries
-- regardless of the caller's role. REVOKE prevents direct invocation by
-- anon/authenticated — only service_role (compute worker) may call this.

create or replace function public.compute_honor_board(
  p_rank_period date
)
returns void
language plpgsql
security definer
set search_path = public, private
set statement_timeout = '30s'
as $$
begin
  -- Delete the existing snapshot for this period so we can refresh it.
  delete from public.honor_board_entries
  where rank_period = p_rank_period;

  -- Insert fresh snapshot.
  -- Only students with at least one completed session and ≥1 page reviewed
  -- in the target month appear on the board.
  -- is_opted_out defaults to false (per-period fresh start; students may call
  -- PATCH /api/honor-board/opt-out after the compute run).
  insert into public.honor_board_entries (
    student_id,
    display_name,
    avatar_url,
    achievement_metric,
    rank_period,
    is_opted_out,
    computed_at
  )
  select
    pr.id,
    coalesce(pr.full_name, pr.full_name_ar, 'Anonymous') as display_name,
    pr.avatar_url,
    round(
      sum(
        coalesce(sp.pages_reviewed, 0)::numeric
        * coalesce(sp.quality_rating, 4.0) / 5.0
      ),
      2
    ) as achievement_metric,
    p_rank_period,
    false,
    now()
  from public.profiles pr
  join public.student_progress sp on sp.student_id = pr.id
  join public.bookings b on b.id = sp.booking_id
  where
    pr.deleted_at is null
    and pr.is_active = true
    and b.status = 'completed'
    and date_trunc('month', b.scheduled_at at time zone 'UTC')
        = date_trunc('month', p_rank_period::timestamptz at time zone 'UTC')
  group by pr.id, pr.full_name, pr.full_name_ar, pr.avatar_url
  having sum(coalesce(sp.pages_reviewed, 0)) > 0;
end;
$$;

-- Revoke direct invocation from unprivileged roles.
revoke execute on function public.compute_honor_board(date) from public, anon, authenticated;
grant  execute on function public.compute_honor_board(date) to service_role;

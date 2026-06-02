-- 20260602000641_murajaah_complete_review_persist_only.sql
-- Spec 001 (murajaah-scheduler), SM-2 — move the recompute OUT of SQL.
--
-- The original complete_review(uuid, int) recomputed the SM-2 interval/easiness
-- inside plpgsql. That logic could not be unit-tested (no pgTAP / PG harness in
-- CI) and shipped a bug: the interval froze at 1 forever, so an item fell due
-- every day and never spaced out. The recompute now lives in a tested pure TS
-- module — src/lib/domains/murajaah/sm2.ts (see sm2.test.ts) — which is the
-- SINGLE source of truth for the algorithm. This function becomes a thin atomic
-- persister: the server action computes {easiness, interval_days} in TS and
-- passes them in; the DB just stamps next_review_at off its own clock and writes.
--
-- Safe to change the signature now: the murajaah feature is inert (no n8n cron
-- wired yet, the card stays hidden), so nothing in prod depends on the old one.
--
-- Defense in depth: the column CHECKs (easiness_factor between 1.3 and 3.5,
-- interval_days >= 0) still reject any out-of-range value regardless of caller,
-- so the invariants hold even if a bad value reaches the function.

drop function if exists public.complete_review(uuid, int);

create or replace function public.complete_review(
  p_schedule_id   uuid,
  p_easiness      real,
  p_interval_days int
)
returns table (next_review_at timestamptz, easiness_factor real, interval_days int)
language plpgsql security invoker set search_path = public as $$
begin
  -- SECURITY INVOKER + the student RLS update policy (student_id = auth.uid())
  -- gate this: a row the caller doesn't own updates 0 rows → not found → raise.
  -- next_review_at is stamped off the DB clock (now()), never passed in, to keep
  -- the schedule clock authoritative and free of client skew.
  return query
    update student_review_schedule
      set easiness_factor  = p_easiness,
          interval_days    = p_interval_days,
          next_review_at   = now() + make_interval(days => p_interval_days),
          last_reviewed_at = now(),
          batch_for_date   = null
      where id = p_schedule_id
      returning student_review_schedule.next_review_at,
                student_review_schedule.easiness_factor,
                student_review_schedule.interval_days;
  if not found then
    raise exception 'schedule row not found' using errcode = 'P0002';
  end if;
end; $$;

-- Same lockdown as the original: student calls it via rpc (RLS-gated invoker);
-- service_role for admin/back-office paths. anon never.
revoke all on function public.complete_review(uuid, real, int) from public, anon;
grant execute on function public.complete_review(uuid, real, int) to authenticated, service_role;

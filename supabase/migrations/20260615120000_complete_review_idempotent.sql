-- Make complete_review() idempotent per due-cycle (audit Fix 1).
--
-- Problem: the prior complete_review() did an UNCONDITIONAL
--   UPDATE student_review_schedule SET ... WHERE id = p_schedule_id
-- The murajaah completion handler (src/app/student/dashboard/murajaah-actions.ts)
-- reads {interval_days, easiness_factor}, computes the next SM-2 state in TS, then
-- calls this RPC. On a double-submit (button double-click / server-action retry)
-- whose second read lands AFTER the first write commits, the second call advances
-- the spacing AGAIN from the already-advanced state (e.g. interval 1 -> 6 -> 16
-- from a single real completion). That OVERSTATES memorization progress, violating
-- the project rule "progress is merged, never overwritten/overstated" (CLAUDE.md §4).
--
-- Fix: guard the advancing UPDATE on `batch_for_date IS NOT NULL` — the canonical
-- "due / not-yet-completed-this-cycle" marker (the compute batch sets it; this
-- function nulls it on completion; partial index idx_srs__batch_for_date matches
-- exactly this predicate). A duplicate submit then matches 0 rows and returns the
-- already-persisted state WITHOUT re-advancing. Genuine bad/foreign ids still raise.
--
-- Concurrency: two simultaneous calls both pass the guard pre-commit, but the
-- UPDATE takes a row lock; the second blocks until the first commits, then
-- re-evaluates its WHERE against the now-updated row (batch_for_date IS NULL) and
-- matches 0 rows — so exactly one advance happens. Safe under READ COMMITTED.
--
-- SM-2 math stays in TypeScript (the tested single source of truth,
-- src/lib/domains/murajaah/sm2.ts) — this migration only makes persistence
-- idempotent. CREATE OR REPLACE preserves the existing GRANTs (authenticated,
-- service_role) and owner. Forward migration only — the baseline is never edited.

create or replace function "public"."complete_review"(
  "p_schedule_id" "uuid",
  "p_easiness" real,
  "p_interval_days" integer
) returns table(
  "next_review_at" timestamp with time zone,
  "easiness_factor" real,
  "interval_days" integer
)
    language "plpgsql"
    -- Explicit SECURITY INVOKER (PG's default, but stated for clarity + to be
    -- immune to any future default change): the UPDATE below must run under the
    -- CALLER's RLS context so the student_review_schedule policy
    -- (student_id = auth.uid()) gates it to the student's own rows. NEVER make
    -- this SECURITY DEFINER — that would bypass the ownership check.
    security invoker
    set "search_path" to 'public'
    as $$
begin
  -- Defense-in-depth input bounds (CodeRabbit). p_easiness/p_interval_days come
  -- from the tested TS SM-2 module (easiness in [1.3,3.5], interval >= 1), but
  -- this RPC is granted to `authenticated`, so a direct caller could otherwise
  -- pass out-of-range values. The table CHECKs catch most, but interval 0 slips
  -- the (interval_days >= 0) CHECK and would stamp next_review_at = now() (an
  -- item stuck perpetually due). Reject at the boundary with clear messages.
  if p_easiness is null or p_easiness < 1.3 then
    raise exception 'invalid easiness_factor: must be >= 1.3 (got %)', p_easiness
      using errcode = '22023';
  end if;
  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'invalid interval_days: must be >= 1 (got %)', p_interval_days
      using errcode = '22023';
  end if;

  -- SECURITY INVOKER + the student RLS update policy (student_id = auth.uid())
  -- gate this: a row the caller doesn't own updates 0 rows.
  -- next_review_at is stamped off the DB clock (now()), never passed in, to keep
  -- the schedule clock authoritative and free of client skew.
  --
  -- batch_for_date IS NOT NULL = the item is in the current due batch and has not
  -- yet been completed this cycle. Completing nulls it, so a duplicate submit
  -- updates 0 rows (idempotent no-op) rather than re-advancing the spacing.
  return query
    update student_review_schedule
      set easiness_factor  = p_easiness,
          interval_days    = p_interval_days,
          next_review_at   = now() + make_interval(days => p_interval_days),
          last_reviewed_at = now(),
          batch_for_date   = null
      where id = p_schedule_id
        and batch_for_date is not null
      returning student_review_schedule.next_review_at,
                student_review_schedule.easiness_factor,
                student_review_schedule.interval_days;
  if found then
    return;
  end if;

  -- No row advanced. Either (a) this review was already completed this cycle
  -- (duplicate submit) — return the persisted state so the caller still sees
  -- success without a second advance; or (b) the row does not exist / is not the
  -- caller's (RLS) — the SELECT returns nothing and we raise as before.
  return query
    select s.next_review_at, s.easiness_factor, s.interval_days
    from student_review_schedule s
    where s.id = p_schedule_id;
  if not found then
    raise exception 'schedule row not found' using errcode = 'P0002';
  end if;
end;
$$;

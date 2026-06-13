-- Prevent double-booking the same teacher slot at the DB level.
-- Uses a partial unique index so cancelled bookings don't block re-use of the slot.
-- Closes issue #244.
--
-- 2026-05-15 amendment: original index-only migration failed on prod with
-- SQLSTATE 23505 because of a real duplicate row (teacher 8565e17e... at
-- 2026-05-01 14:00 UTC). Per the migration's own header comment, that
-- means existing duplicates must be resolved before the constraint can
-- apply. Doing it inline (cancel newer duplicates, then create the
-- index, all in one migration) is safe because:
--   1. The migration never recorded as applied — repeating it is a no-op
--      after the first successful run.
--   2. Dedup is deterministic: oldest non-cancelled row per slot survives.
--   3. Cancellation is non-destructive (status update + audit trail).
--
-- Future re-runs of this migration are safe: the dedup CTE will find no
-- duplicates after the first successful application.

-- Step 1: Cancel duplicates (keep oldest non-cancelled per slot).
with ranked as (
  select
    id,
    row_number() over (
      partition by teacher_id, scheduled_at
      order by created_at
    ) as rn
  from bookings
  where status <> 'cancelled'
)
update bookings b
set
  status        = 'cancelled',
  cancelled_at  = now(),
  cancel_reason = 'auto-cancelled by migration 20260515123120: duplicate slot (older row in same (teacher_id, scheduled_at) group survived)'
from ranked r
where b.id = r.id
  and r.rn > 1;

-- Step 2: Create the partial unique index.
create unique index if not exists bookings_teacher_slot_unique_idx
  on bookings(teacher_id, scheduled_at)
  where status <> 'cancelled';

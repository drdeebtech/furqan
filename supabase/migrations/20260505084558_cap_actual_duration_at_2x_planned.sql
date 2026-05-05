-- Cap sessions.actual_duration at 2× the booking's planned duration.
--
-- Why: The 2026-05-05 process audit caught sessions with absurd actual_duration
-- values (eg 18,630 min on a 30-min slot). Root cause: trackSessionEvent() sets
-- started_at on first participant join, but never auto-clears or auto-ends.
-- When a session is left "open" and only ends days later (admin manual,
-- auto-completion cron, or just neglect), the trigger correctly multiplies
-- (ended_at - started_at) into a huge minute count.
--
-- Long-term fix is to wire Daily.co webhooks for meeting.started/meeting.ended
-- so started_at means "actual call start" not "first page-visit join". That's
-- a separate piece of work.
--
-- This migration is the defensive cap: if the computed duration exceeds 2× the
-- booking's planned_duration, store NULL instead of the corrupt value. Reading
-- code already handles `actual_duration IS NULL` gracefully (eg displays "—").
--
-- Backfill: same logic applied to existing rows so dashboards stop showing
-- nonsense for the 2 already-corrupt sessions in production.

CREATE OR REPLACE FUNCTION public.calc_actual_duration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  raw_minutes INTEGER;
  planned_minutes INTEGER;
BEGIN
  IF NEW.started_at IS NOT NULL AND NEW.ended_at IS NOT NULL THEN
    raw_minutes := ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60);

    SELECT duration_min INTO planned_minutes
      FROM bookings WHERE id = NEW.booking_id;

    -- Cap at 2× planned. A 30-min slot can legitimately run to ~60min; beyond
    -- that, the data is almost certainly corrupt (someone left the room open).
    -- Surfacing NULL is more honest than a fabricated number.
    IF planned_minutes IS NOT NULL AND raw_minutes > planned_minutes * 2 THEN
      NEW.actual_duration = NULL;
    ELSE
      NEW.actual_duration = raw_minutes;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Backfill: re-evaluate every existing row through the new logic.
-- Touching ended_at with itself fires the trigger without changing the value,
-- which lets us re-run calc_actual_duration() across the whole table.
UPDATE sessions s
SET ended_at = s.ended_at
WHERE s.actual_duration IS NOT NULL
  AND s.actual_duration > (
    SELECT b.duration_min * 2
    FROM bookings b
    WHERE b.id = s.booking_id
  );

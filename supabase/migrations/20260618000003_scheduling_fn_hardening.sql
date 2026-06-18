-- T021a: Scheduling function hardening (CodeRabbit CR3 follow-up).
--
-- Supabase best practice: never edit an applied migration in place — it
-- breaks the migration-hash integrity check on remotes that already
-- applied the original. This follow-up migration re-declares the three
-- SECURITY DEFINER functions in spec 020 with three classes of fix:
--
--   1. SET search_path = public on every SECURITY DEFINER function to
--      close the search-path hijack vector (CVE class). The original
--      migrations omitted this on materialize_availability_instances,
--      lock_slot_instance, and increment_enrollment.
--
--   2. NULL-slot guard in lock_slot_instance: SELECT INTO leaves
--      v_already_booked NULL when p_slot_id does not exist, so the
--      IF v_already_booked THEN check passes (NULL is not true) and the
--      function returns true despite locking nothing — a false-success
--      bug. IF NOT FOUND THEN RETURN false closes it.
--
--   3. Comment correction on open_overflow_halaqa: ORDER BY
--      current_enrollment DESC is "most-full first", not "least-empty".
--      Behavior unchanged; comment now matches code.
--
-- All three functions are CREATE OR REPLACE, so this migration is safe
-- to apply on remotes that already have the originals AND on fresh
-- installs (idempotent).

-- ────────────────────────────────────────────────────────────────────────
-- materialize_availability_instances: add SET search_path = public.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION materialize_availability_instances(p_horizon_end date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- For each active template, insert one instance per matching day_of_week up to the horizon.
  -- 0=Sunday..6=Saturday (Postgres extract(dow ...) also uses 0-6).
  INSERT INTO teacher_availability_instances (template_id, teacher_id, slot_date, start_time, end_time)
  SELECT
    ta.id,
    ta.teacher_id,
    d::date,
    ta.start_time,
    ta.end_time
  FROM teacher_availability ta,
       generate_series(now()::date, p_horizon_end, '1 day'::interval) d
  WHERE ta.is_active = true
    AND extract(dow from d) = ta.day_of_week
  ON CONFLICT (template_id, slot_date) DO NOTHING;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- lock_slot_instance: add SET search_path + NULL-slot false-success guard.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lock_slot_instance(p_slot_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_already_booked boolean;
BEGIN
  SELECT is_booked INTO v_already_booked
  FROM teacher_availability_instances
  WHERE id = p_slot_id
  FOR UPDATE;

  -- Non-existent slot: SELECT INTO leaves v_already_booked NULL. Without
  -- this guard the IF below passes (NULL is not true) and the function
  -- would RETURN true despite locking nothing — a false-success bug.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_already_booked THEN
    RETURN false;
  END IF;

  UPDATE teacher_availability_instances
  SET is_booked = true
  WHERE id = p_slot_id;

  RETURN true;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- open_overflow_halaqa: comment-only correction (most-full, not least-empty).
-- Function body unchanged; re-declared only to keep sibling ordering intent
-- legible to future maintainers. SET search_path already present.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION open_overflow_halaqa(p_source_offering_id uuid)
RETURNS TABLE(halaqa_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sibling_id uuid;
  v_new_id     uuid;
  v_source     class_offerings%ROWTYPE;
BEGIN
  -- FOR SHARE on source to prevent concurrent clone storms
  SELECT * INTO v_source
  FROM class_offerings
  WHERE id = p_source_offering_id
  FOR SHARE;

  -- Prefer not-full sibling (same teacher_id + program_level + status='open' + current_enrollment < capacity)
  SELECT id INTO v_sibling_id
  FROM class_offerings
  WHERE teacher_id        = v_source.teacher_id
    AND program_level     = v_source.program_level
    AND status            = 'open'
    AND current_enrollment < capacity
    AND id                <> p_source_offering_id
  ORDER BY current_enrollment DESC  -- most-full first (consolidate students into fewer groups)
  LIMIT 1;

  IF v_sibling_id IS NOT NULL THEN
    RETURN QUERY SELECT v_sibling_id, false;
    RETURN;
  END IF;

  -- open a new halaqa cloning the source
  INSERT INTO class_offerings
    (teacher_id, program_level, capacity, status, schedule_json, session_duration_min, start_date)
  SELECT
    teacher_id, program_level, capacity, 'open', schedule_json, session_duration_min, now()::date
  FROM class_offerings
  WHERE id = p_source_offering_id
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- increment_enrollment: add SET search_path = public.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_enrollment(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE class_offerings
  SET current_enrollment = current_enrollment + 1
  WHERE id = p_offering_id;
END;
$$;

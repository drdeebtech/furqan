-- T021b: Scheduling function concurrency + capacity hardening (CodeRabbit CR4).
--
-- Two real Major findings on the 20260618000003 hardening migration:
--
--   1. open_overflow_halaqa used FOR SHARE on the source row. FOR SHARE
--      blocks concurrent UPDATE/DELETE on the source but does NOT
--      serialize two concurrent open_overflow_halaqa calls for the same
--      source — both can acquire SHARE locks simultaneously, both pass
--      the "is there a not-full sibling" check, and both proceed to
--      INSERT distinct overflow halaqas (clone storm). Switching to
--      FOR UPDATE on the source row serializes the function: the second
--      caller blocks until the first commits, then sees the sibling the
--      first caller created (or the freshly-cloned overflow) and reuses
--      it instead of creating another.
--
--   2. increment_enrollment incremented unconditionally — a race between
--      a capacity check and the increment could over-enroll a halaqa
--      past its capacity. Adding `AND current_enrollment < capacity` to
--      the WHERE clause makes the guard atomic with the increment. If
--      zero rows are updated (offering missing OR already at capacity),
--      raise an exception so the caller sees the failure rather than
--      silently no-op'ing.
--
-- Both functions are CREATE OR REPLACE — idempotent and safe on remotes
-- that already applied earlier migrations.

-- ────────────────────────────────────────────────────────────────────────
-- open_overflow_halaqa: FOR SHARE → FOR UPDATE to serialize clone storms.
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
  -- FOR UPDATE on source serializes concurrent open_overflow_halaqa calls
  -- for the same source. The second caller blocks until the first commits,
  -- then sees the sibling/overflow the first caller created and reuses it.
  SELECT * INTO v_source
  FROM class_offerings
  WHERE id = p_source_offering_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'open_overflow_halaqa: source offering % not found', p_source_offering_id
      USING ERRCODE = 'P0002';
  END IF;

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

  -- Open a new halaqa cloning the source.
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
-- increment_enrollment: atomic capacity guard.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_enrollment(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE class_offerings
  SET current_enrollment = current_enrollment + 1
  WHERE id = p_offering_id
    AND current_enrollment < capacity;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Either the offering doesn't exist, or it is already at/above
    -- capacity. Raise so the caller can surface "halaqa full" rather
    -- than silently no-op and over-promise enrollment.
    RAISE EXCEPTION 'increment_enrollment: offering % not found or at capacity', p_offering_id
      USING ERRCODE = 'P0003';
  END IF;
END;
$$;

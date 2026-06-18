-- T004: Create open_overflow_halaqa SECURITY DEFINER function.
-- Prefer sibling; else clone source to open new halaqa.

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
  -- Match program_level exactly (NULL matching is strand-guarded at creation path).
  SELECT id INTO v_sibling_id
  FROM class_offerings
  WHERE teacher_id        = v_source.teacher_id
    AND program_level     = v_source.program_level
    AND status            = 'open'
    AND current_enrollment < capacity
    AND id                <> p_source_offering_id
  ORDER BY current_enrollment DESC  -- least-empty first (deterministic sibling reuse)
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

REVOKE EXECUTE ON FUNCTION open_overflow_halaqa(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION open_overflow_halaqa(uuid) TO service_role;

-- T015: Atomic enrollment increment
CREATE OR REPLACE FUNCTION increment_enrollment(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE class_offerings
  SET current_enrollment = current_enrollment + 1
  WHERE id = p_offering_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_enrollment(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION increment_enrollment(uuid) TO service_role;

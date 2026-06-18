-- T003a: Create teacher_availability_instances table and materialization function.
-- Dated instances of recurring templates for booking. 
-- Applies AFTER T002a and BEFORE T003 (timestamp sorts accordingly).

CREATE TABLE teacher_availability_instances (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid        NOT NULL REFERENCES teacher_availability(id) ON DELETE CASCADE,
  teacher_id      uuid        NOT NULL REFERENCES profiles(id),
  slot_date       date        NOT NULL,
  start_time      time        NOT NULL,
  end_time        time        NOT NULL,
  is_booked       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Idempotent materialization guard
CREATE UNIQUE INDEX uix_tai_template_date ON teacher_availability_instances(template_id, slot_date);

-- Lookup index for open slots
CREATE INDEX idx_tai_open_slots ON teacher_availability_instances(teacher_id, slot_date) WHERE is_booked = false;

-- RLS
ALTER TABLE teacher_availability_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tai_select" ON teacher_availability_instances
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()) OR private.is_admin_or_mod());

CREATE POLICY "tai_service_insert" ON teacher_availability_instances
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tai_service_update" ON teacher_availability_instances
  FOR UPDATE TO service_role USING (true);

-- Materialization Function (NFR-002)
CREATE OR REPLACE FUNCTION materialize_availability_instances(p_horizon_end date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

REVOKE EXECUTE ON FUNCTION materialize_availability_instances(date) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION materialize_availability_instances(date) TO service_role;

-- T008: Atomic lock for dated slot instance
CREATE OR REPLACE FUNCTION lock_slot_instance(p_slot_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_already_booked boolean;
BEGIN
  SELECT is_booked INTO v_already_booked
  FROM teacher_availability_instances
  WHERE id = p_slot_id
  FOR UPDATE;

  IF v_already_booked THEN
    RETURN false;
  END IF;

  UPDATE teacher_availability_instances
  SET is_booked = true
  WHERE id = p_slot_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_slot_instance(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lock_slot_instance(uuid) TO service_role;

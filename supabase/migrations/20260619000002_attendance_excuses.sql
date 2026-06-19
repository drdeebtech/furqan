-- T004: attendance + excuses tables, enums, RLS, identity guards.

CREATE TYPE attendance_outcome AS ENUM (
  'present', 'student_absent', 'teacher_absent', 'excused_carried'
);

CREATE TYPE credit_action AS ENUM ('none', 'debited', 'restored');

CREATE TYPE excuse_status AS ENUM ('pending', 'accepted', 'rejected', 'ineligible');

-- ────────────────────────────────────────────────────────────────────────
-- attendance_records: one finalized outcome per booking.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE attendance_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL UNIQUE REFERENCES bookings(id),
  student_id    uuid NOT NULL REFERENCES profiles(id),
  teacher_id    uuid NOT NULL REFERENCES profiles(id),
  session_id    uuid REFERENCES sessions(id),
  outcome       attendance_outcome NOT NULL,
  credit_action credit_action NOT NULL DEFAULT 'none',
  finalized_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendance_student ON attendance_records(student_id);
CREATE INDEX idx_attendance_teacher ON attendance_records(teacher_id);

CREATE TRIGGER attendance_records_set_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_student_select" ON attendance_records
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "ar_teacher_select" ON attendance_records
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "ar_admin_select" ON attendance_records
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "ar_service_insert" ON attendance_records
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "ar_service_update" ON attendance_records
  FOR UPDATE TO service_role USING (true);

CREATE OR REPLACE FUNCTION guard_attendance_records_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.booking_id <> NEW.booking_id
  OR OLD.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'attendance_records: identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_records_identity_guard
  BEFORE UPDATE OF booking_id, student_id
  ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_records_identity();

-- ────────────────────────────────────────────────────────────────────────
-- excuse_requests: one per booking; eligibility set at submission.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE excuse_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  student_id   uuid NOT NULL REFERENCES profiles(id),
  teacher_id   uuid NOT NULL REFERENCES profiles(id),
  reason       text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_eligible  boolean NOT NULL,
  status       excuse_status NOT NULL DEFAULT 'pending',
  decided_by   uuid REFERENCES profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uix_excuse_per_booking ON excuse_requests(booking_id);
CREATE INDEX idx_excuse_student ON excuse_requests(student_id);
CREATE INDEX idx_excuse_teacher ON excuse_requests(teacher_id);

ALTER TABLE excuse_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "er_student_select" ON excuse_requests
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "er_teacher_select" ON excuse_requests
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "er_admin_select" ON excuse_requests
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "er_student_insert" ON excuse_requests
  FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

CREATE POLICY "er_teacher_update" ON excuse_requests
  FOR UPDATE TO authenticated
  USING (teacher_id = (SELECT auth.uid()))
  WITH CHECK (teacher_id = (SELECT auth.uid()));

CREATE POLICY "er_admin_update" ON excuse_requests
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "er_service_insert" ON excuse_requests
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "er_service_update" ON excuse_requests
  FOR UPDATE TO service_role USING (true);

CREATE OR REPLACE FUNCTION guard_excuse_requests_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.booking_id <> NEW.booking_id
  OR OLD.student_id <> NEW.student_id
  OR OLD.teacher_id <> NEW.teacher_id
  OR OLD.is_eligible <> NEW.is_eligible THEN
    RAISE EXCEPTION 'excuse_requests: identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER excuse_requests_identity_guard
  BEFORE UPDATE OF booking_id, student_id, teacher_id, is_eligible
  ON excuse_requests
  FOR EACH ROW EXECUTE FUNCTION guard_excuse_requests_identity();

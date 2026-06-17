-- T003: Create subscription_teacher_assignments table, indexes, and RLS.
-- Plus sibling index on class_offerings (requires program_level from T002a).

CREATE TABLE subscription_teacher_assignments (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_id                      uuid        NOT NULL REFERENCES profiles(id),
  subscription_id                 uuid        NOT NULL REFERENCES subscriptions(id),
  product_type                    text        NOT NULL CHECK (product_type IN ('hifz_individual','hifz_group','course')),
  lock_month                      date        NOT NULL,   -- first day of the locked calendar month (e.g. 2026-07-01)
  is_active                       boolean     NOT NULL DEFAULT true,
  approved_by                     uuid        REFERENCES profiles(id),  -- NULL = renewal; set = admin mid-month approval
  cancelled_future_bookings_at    timestamptz,            -- set when admin change resolves future bookings
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current
CREATE TRIGGER set_updated_at_sta
  BEFORE UPDATE ON subscription_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Partial unique: one active assignment per student
CREATE UNIQUE INDEX uix_sta_student_active
  ON subscription_teacher_assignments(student_id)
  WHERE is_active = true;

-- Lookup indexes
CREATE INDEX idx_sta_student  ON subscription_teacher_assignments(student_id)  WHERE is_active;
CREATE INDEX idx_sta_teacher  ON subscription_teacher_assignments(teacher_id)  WHERE is_active;

-- Sibling lookup index for class_offerings (T004 prerequisite)
CREATE INDEX idx_class_offerings_sibling 
  ON class_offerings(teacher_id, program_level, status);

-- RLS
ALTER TABLE subscription_teacher_assignments ENABLE ROW LEVEL SECURITY;

-- Students read their own
CREATE POLICY "sta_student_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

-- Teachers read assignments where they are assigned
CREATE POLICY "sta_teacher_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

-- Admins/mods read all
CREATE POLICY "sta_admin_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (private.is_admin_or_mod());

-- Only service_role may INSERT
CREATE POLICY "sta_service_insert" ON subscription_teacher_assignments
  FOR INSERT TO service_role WITH CHECK (true);

-- service_role and admin session may UPDATE allowed columns
CREATE POLICY "sta_service_update" ON subscription_teacher_assignments
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "sta_admin_update" ON subscription_teacher_assignments
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- Identity Guard Trigger
CREATE OR REPLACE FUNCTION guard_sta_identity_cols()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.student_id <> NEW.student_id
  OR OLD.subscription_id <> NEW.subscription_id
  OR OLD.product_type <> NEW.product_type
  OR OLD.lock_month <> NEW.lock_month THEN
    RAISE EXCEPTION 'subscription_teacher_assignments: identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sta_identity_guard
  BEFORE UPDATE OF student_id, subscription_id, product_type, lock_month
  ON subscription_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_sta_identity_cols();

-- T005: payroll tables — session_deliveries (rate snapshot) + teacher_payouts (ledger).

CREATE TYPE payout_status AS ENUM ('pending', 'paid', 'failed');

-- ────────────────────────────────────────────────────────────────────────
-- session_deliveries: one per delivered session; rate snapshotted at delivery.
-- Fully immutable after insert (no UPDATE/DELETE policy).
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE session_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL UNIQUE REFERENCES sessions(id),
  teacher_id          uuid NOT NULL REFERENCES profiles(id),
  duration_minutes    integer NOT NULL CHECK (duration_minutes > 0),
  hourly_rate_usd     numeric(10,2) NOT NULL CHECK (hourly_rate_usd >= 0),
  delivered_at        timestamptz NOT NULL,
  payroll_period_month date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_deliveries_teacher_month
  ON session_deliveries(teacher_id, payroll_period_month);

ALTER TABLE session_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sd_teacher_select" ON session_deliveries
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "sd_admin_select" ON session_deliveries
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "sd_service_insert" ON session_deliveries
  FOR INSERT TO service_role WITH CHECK (true);

-- No UPDATE/DELETE policies — table is fully immutable post-insert.

CREATE OR REPLACE FUNCTION guard_session_deliveries_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'session_deliveries is immutable after insert';
END;
$$;

CREATE TRIGGER session_deliveries_immutable_guard
  BEFORE UPDATE OF session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at
  ON session_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_session_deliveries_immutable();

-- ────────────────────────────────────────────────────────────────────────
-- teacher_payouts: one row per teacher per payroll month.
-- Financial columns immutable; only `status` may be updated (by admin/service).
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE teacher_payouts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id           uuid NOT NULL REFERENCES profiles(id),
  payroll_period_month date NOT NULL,
  total_hours          numeric(10,2) NOT NULL CHECK (total_hours >= 0),
  hourly_rate_usd      numeric(10,2) NOT NULL CHECK (hourly_rate_usd >= 0),
  total_amount_usd     numeric(10,2) NOT NULL CHECK (total_amount_usd >= 0),
  status               payout_status NOT NULL DEFAULT 'pending',
  run_at               timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uix_teacher_payouts_period
  ON teacher_payouts(teacher_id, payroll_period_month);

CREATE INDEX idx_teacher_payouts_teacher ON teacher_payouts(teacher_id);

ALTER TABLE teacher_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tp_teacher_select" ON teacher_payouts
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "tp_admin_select" ON teacher_payouts
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "tp_service_insert" ON teacher_payouts
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tp_service_update" ON teacher_payouts
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "tp_admin_update" ON teacher_payouts
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE OR REPLACE FUNCTION guard_teacher_payouts_financials()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.teacher_id <> NEW.teacher_id
  OR OLD.payroll_period_month <> NEW.payroll_period_month
  OR OLD.total_hours <> NEW.total_hours
  OR OLD.hourly_rate_usd <> NEW.hourly_rate_usd
  OR OLD.total_amount_usd <> NEW.total_amount_usd THEN
    RAISE EXCEPTION 'teacher_payouts: financial columns are immutable after insert (only status may change)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teacher_payouts_financials_guard
  BEFORE UPDATE OF teacher_id, payroll_period_month, total_hours, hourly_rate_usd, total_amount_usd
  ON teacher_payouts
  FOR EACH ROW EXECUTE FUNCTION guard_teacher_payouts_financials();

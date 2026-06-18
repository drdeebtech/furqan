-- T003: subscription_extensions table + RLS + identity guard + platform_settings seeds.
--
-- Carry-over compensation accumulates here instead of mutating the
-- Stripe-mirrored subscriptions.current_period_end (which spec 018's
-- identity guard protects). Effective period end is computed on read as
-- current_period_end + SUM(extension_seconds).
--
-- Idempotency anchor = booking_id (NOT the nullable session_id) — per
-- spec Clarifications §2026-06-16: bookings.session_id is nullable, so
-- it cannot anchor one-grant-per-event for individual sessions.

CREATE TABLE subscription_extensions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     uuid NOT NULL REFERENCES subscriptions(id),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  session_id          uuid REFERENCES sessions(id),
  granted_by_user_id  uuid NOT NULL REFERENCES profiles(id),
  reason              text NOT NULL,
  extension_seconds   bigint NOT NULL CHECK (extension_seconds > 0),
  granted_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one extension grant per (subscription, booking).
CREATE UNIQUE INDEX uix_subscription_extensions_booking
  ON subscription_extensions(subscription_id, booking_id);

CREATE INDEX idx_subscription_extensions_sub ON subscription_extensions(subscription_id);

-- RLS
ALTER TABLE subscription_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "se_student_select" ON subscription_extensions
  FOR SELECT TO authenticated
  USING (subscription_id IN (SELECT id FROM subscriptions WHERE student_id = (SELECT auth.uid())));

CREATE POLICY "se_admin_select" ON subscription_extensions
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "se_service_insert" ON subscription_extensions
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "se_service_update" ON subscription_extensions
  FOR UPDATE TO service_role USING (true);

-- Identity guard: immutable after insert.
CREATE OR REPLACE FUNCTION guard_subscription_extensions_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.extension_seconds <> NEW.extension_seconds
  OR OLD.subscription_id <> NEW.subscription_id
  OR OLD.booking_id <> NEW.booking_id
  OR OLD.session_id IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'subscription_extensions: identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_extensions_identity_guard
  BEFORE UPDATE OF extension_seconds, subscription_id, booking_id, session_id
  ON subscription_extensions
  FOR EACH ROW EXECUTE FUNCTION guard_subscription_extensions_identity();

-- Seed platform_settings for spec 021 (idempotent).
INSERT INTO platform_settings (key, value) VALUES
  ('excuse_notice_threshold_seconds', '7200'),
  ('payroll_run_day_of_month', '1')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- V13.2: Retention Signals
-- Student retention scoring for churn detection and intervention tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retention_signals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid        NOT NULL UNIQUE REFERENCES profiles(id),
  last_booking_at      timestamptz,
  last_session_at      timestamptz,
  last_login_at        timestamptz,
  package_remaining    integer,
  package_expires_at   timestamptz,
  engagement_score     numeric(5,2),
  churn_risk_score     numeric(5,2),
  last_intervention_at timestamptz,
  intervention_type    text,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retention_churn ON retention_signals(churn_risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_retention_student ON retention_signals(student_id);

ALTER TABLE retention_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_mod_retention" ON retention_signals FOR ALL USING (is_admin_or_mod());

INSERT INTO schema_migrations (version, description)
VALUES ('13.2.0', 'V13: Retention signals table for churn detection')
ON CONFLICT DO NOTHING;

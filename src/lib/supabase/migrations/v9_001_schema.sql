-- V9 Migration: Moderator role, CV workflow, evaluations, observations, feature flags
-- Run as separate statements. The ALTER TYPE must be outside a transaction.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add 'moderator' to user_role enum (must run standalone, outside transaction)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'moderator';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. New ENUM types
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE cv_status AS ENUM ('draft', 'pending_review', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE evaluation_type AS ENUM ('weekly', 'biweekly', 'monthly', 'quarterly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM ('session_summary', 'evaluation', 'custom', 'missed_session', 'schedule_change');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ALTER existing tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- profiles: parent/guardian fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth date;

-- teacher_profiles: CV workflow
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS cv_status cv_status DEFAULT 'draft';
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS cv_submitted_at timestamptz;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS cv_reviewed_by uuid REFERENCES profiles(id);
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS cv_reviewed_at timestamptz;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS cv_rejection_reason text;

-- bookings: teacher confirmation
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS teacher_confirmed boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS teacher_confirmed_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decline_reason text;

-- sessions: observation
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS admin_observer_id uuid REFERENCES profiles(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_observable boolean DEFAULT true;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS observer_joined_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS observer_notes text;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. New tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- platform_settings (key-value feature flags & config)
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

-- session_evaluations
CREATE TABLE IF NOT EXISTS session_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id),
  teacher_id uuid NOT NULL REFERENCES profiles(id),
  evaluator_id uuid NOT NULL REFERENCES profiles(id),
  evaluation_type evaluation_type NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  hifz_score smallint CHECK (hifz_score BETWEEN 1 AND 10),
  tajweed_score smallint CHECK (tajweed_score BETWEEN 1 AND 10),
  akhlaq_score smallint CHECK (akhlaq_score BETWEEN 1 AND 10),
  attendance_score smallint CHECK (attendance_score BETWEEN 1 AND 10),
  overall_score smallint CHECK (overall_score BETWEEN 1 AND 10),
  strengths text,
  weaknesses text,
  recommendations text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- parent_reports
CREATE TABLE IF NOT EXISTS parent_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id),
  teacher_id uuid REFERENCES profiles(id),
  report_type report_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  sent_to_email text,
  sent_to_phone text,
  sent_at timestamptz,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- session_notes_history (audit trail for session notes edits)
CREATE TABLE IF NOT EXISTS session_notes_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  notes text NOT NULL,
  saved_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- session_observers (tracks who observed which session)
CREATE TABLE IF NOT EXISTS session_observers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  observer_id uuid NOT NULL REFERENCES profiles(id),
  joined_at timestamptz,
  left_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. SQL functions for role checks
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_moderator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'moderator'
      AND deleted_at IS NULL
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION is_admin_or_mod() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'moderator')
      AND deleted_at IS NULL
      AND is_active = true
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RLS policies for new tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_notes_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_observers ENABLE ROW LEVEL SECURITY;

-- platform_settings: admin/mod can read+write, everyone can read
CREATE POLICY "anyone_read_settings" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "admin_mod_write_settings" ON platform_settings FOR ALL USING (is_admin_or_mod());

-- session_evaluations: admin/mod full access, teacher reads own, student reads own
CREATE POLICY "admin_mod_eval" ON session_evaluations FOR ALL USING (is_admin_or_mod());
CREATE POLICY "teacher_read_eval" ON session_evaluations FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "student_read_eval" ON session_evaluations FOR SELECT USING (student_id = auth.uid());

-- parent_reports: admin/mod full access, teacher reads own
CREATE POLICY "admin_mod_reports" ON parent_reports FOR ALL USING (is_admin_or_mod());
CREATE POLICY "teacher_read_reports" ON parent_reports FOR SELECT USING (teacher_id = auth.uid());

-- session_notes_history: admin/mod full access, teacher reads own
CREATE POLICY "admin_mod_notes_history" ON session_notes_history FOR ALL USING (is_admin_or_mod());
CREATE POLICY "teacher_notes_history" ON session_notes_history FOR SELECT USING (saved_by = auth.uid());

-- session_observers: admin/mod full access
CREATE POLICY "admin_mod_observers" ON session_observers FOR ALL USING (is_admin_or_mod());

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Seed platform_settings with default feature flags
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value, description) VALUES
  ('hide_reviews', 'true', 'Hide reviews section on public pages'),
  ('hide_prices', 'true', 'Hide pricing on public pages')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Record migration
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, description)
VALUES ('9.0.0', 'V9: moderator role, CV workflow, evaluations, observations, feature flags')
ON CONFLICT DO NOTHING;

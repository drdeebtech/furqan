-- ============================================================================
-- V14: Audit Fixes
-- Fixes broken credit triggers, missing RLS policies, missing indexes,
-- missing triggers, and soft-delete indexes.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 — CRITICAL: Fix broken credit deduction/restore triggers
-- UPDATE ... ORDER BY ... LIMIT is not valid Postgres. Rewrite with CTE.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION deduct_student_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    WITH target AS (
      SELECT id FROM student_credits
      WHERE student_id = NEW.student_id
        AND (teacher_id IS NULL OR teacher_id = NEW.teacher_id)
        AND used < total
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY expires_at ASC NULLS LAST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE student_credits
    SET used = used + 1
    WHERE id = (SELECT id FROM target);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION restore_student_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
    WITH target AS (
      SELECT id FROM student_credits
      WHERE student_id = NEW.student_id
        AND (teacher_id IS NULL OR teacher_id = NEW.teacher_id)
        AND used > 0
      ORDER BY expires_at ASC NULLS LAST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE student_credits
    SET used = GREATEST(used - 1, 0)
    WHERE id = (SELECT id FROM target);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 — CRITICAL: Add admin/moderator RLS policies for sessions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Admin/mod full access to sessions
CREATE POLICY sessions_admin ON sessions
  FOR ALL USING (is_admin_or_mod());

-- Teachers can update their own sessions (end session, save notes)
CREATE POLICY sessions_teacher_update ON sessions
  FOR UPDATE USING (
    booking_id IN (SELECT id FROM bookings WHERE teacher_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 — CRITICAL: Add admin RLS policy for student_credits
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY credits_admin ON student_credits
  FOR ALL USING (is_admin());

-- ═══════════════════════════════════════════════════════════════════════════════
-- P1 — HIGH: Add indexes on session_evaluations
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_eval_student
  ON session_evaluations(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_teacher
  ON session_evaluations(teacher_id, created_at DESC);

-- Partial index for flagged evaluations (score <= 3), used by moderator dashboard
CREATE INDEX IF NOT EXISTS idx_eval_flagged
  ON session_evaluations(overall_score, created_at DESC)
  WHERE overall_score IS NOT NULL AND overall_score <= 3;

-- ═══════════════════════════════════════════════════════════════════════════════
-- P1 — HIGH: Create missing V9 tables (session_notes_history, session_observers)
-- These were defined in v9_001_schema.sql but not applied to production.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_notes_history (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES sessions(id),
  notes      text        NOT NULL,
  saved_by   uuid        NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE session_notes_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_mod_notes_history" ON session_notes_history FOR ALL USING (is_admin_or_mod());
CREATE POLICY "teacher_notes_history" ON session_notes_history FOR SELECT USING (saved_by = auth.uid());

CREATE TABLE IF NOT EXISTS session_observers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES sessions(id),
  observer_id uuid        NOT NULL REFERENCES profiles(id),
  joined_at   timestamptz,
  left_at     timestamptz,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE session_observers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_mod_observers" ON session_observers FOR ALL USING (is_admin_or_mod());

-- ═══════════════════════════════════════════════════════════════════════════════
-- P1 — HIGH: Add indexes on V9 tables (parent_reports, notes_history, observers)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_parent_reports_student
  ON parent_reports(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_parent_reports_teacher
  ON parent_reports(teacher_id);

CREATE INDEX IF NOT EXISTS idx_notes_history_session
  ON session_notes_history(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_observers_session
  ON session_observers(session_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- P1 — HIGH: Add missing updated_at trigger on session_evaluations
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER t_session_evaluations_upd
  BEFORE UPDATE ON session_evaluations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- P2 — MEDIUM: Add admin/moderator RLS on conversations and messages
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY conv_admin ON conversations
  FOR ALL USING (is_admin_or_mod());

CREATE POLICY msg_admin ON messages
  FOR ALL USING (is_admin_or_mod());

-- ═══════════════════════════════════════════════════════════════════════════════
-- P2 — MEDIUM: Partial indexes for soft-delete columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- Active profiles (most queries need only active, non-deleted profiles)
CREATE INDEX IF NOT EXISTS idx_profiles_active
  ON profiles(role)
  WHERE deleted_at IS NULL AND is_active = true;

-- Active bookings (non-deleted) by student, used in dashboard queries
CREATE INDEX IF NOT EXISTS idx_bookings_active_student
  ON bookings(student_id, scheduled_at DESC)
  WHERE deleted_at IS NULL;

-- Active bookings (non-deleted) by teacher
CREATE INDEX IF NOT EXISTS idx_bookings_active_teacher
  ON bookings(teacher_id, scheduled_at DESC)
  WHERE deleted_at IS NULL;

-- Non-deleted messages, used in conversation views
CREATE INDEX IF NOT EXISTS idx_messages_active
  ON messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- P2 — MEDIUM: Add missing updated_at trigger on blog_posts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER t_blog_posts_upd
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- P3 — LOW: Index for notification expiry cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_notifications_expired
  ON notifications(expires_at)
  WHERE expires_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration record
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, description)
VALUES ('14.1.0', 'V14: Audit fixes — credit triggers, RLS gaps, missing indexes, missing triggers')
ON CONFLICT DO NOTHING;

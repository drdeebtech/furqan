-- ============================================================================
-- V10.2: Homework Assignments System
-- Adds structured homework tracking with state machine, grading, and
-- auto-regeneration for the FURQAN Academy platform.
-- ============================================================================

-- ─── 1. New ENUM types ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE homework_type AS ENUM (
    'hifz',        -- حفظ — memorize new verses
    'muraja',      -- مراجعة — review previously memorized
    'recitation',  -- تلاوة — practice recitation
    'tajweed',     -- تجويد — tajweed rules practice
    'writing',     -- كتابة — writing exercises
    'listening'    -- استماع — listening exercises
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE homework_status AS ENUM (
    'assigned',              -- teacher created assignment
    'student_ready',         -- student confirmed readiness
    'completed_excellent',   -- graded: ممتاز
    'completed_good',        -- graded: جيد
    'completed_needs_work',  -- graded: يحتاج تحسين (auto-regenerates)
    'completed_not_done'     -- graded: لم يُنجز (auto-regenerates)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add 'homework' to notification types
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'homework';

-- ─── 2. homework_assignments table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS homework_assignments (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid        REFERENCES sessions(id),
  booking_id           uuid        NOT NULL REFERENCES bookings(id),
  teacher_id           uuid        NOT NULL REFERENCES profiles(id),
  student_id           uuid        NOT NULL REFERENCES profiles(id),

  homework_type        homework_type   NOT NULL,
  status               homework_status NOT NULL DEFAULT 'assigned',

  title                text        NOT NULL,
  description          text,

  -- Quran-specific fields (nullable for non-Quran homework types)
  surah_number         smallint    CHECK (surah_number BETWEEN 1 AND 114),
  ayah_start           smallint    CHECK (ayah_start >= 1),
  ayah_end             smallint    CHECK (ayah_end >= 1),
  pages_count          smallint    CHECK (pages_count >= 1),

  due_date             date,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  ready_at             timestamptz,
  completed_at         timestamptz,

  teacher_notes        text,       -- grading feedback

  -- Self-referencing FK for auto-regenerated assignments chain
  parent_assignment_id uuid        REFERENCES homework_assignments(id),

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ayah_range_valid CHECK (
    ayah_end IS NULL OR ayah_start IS NULL OR ayah_end >= ayah_start
  )
);

-- ─── 3. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_homework_student_status
  ON homework_assignments(student_id, status);

CREATE INDEX IF NOT EXISTS idx_homework_teacher_status
  ON homework_assignments(teacher_id, status);

CREATE INDEX IF NOT EXISTS idx_homework_booking
  ON homework_assignments(booking_id);

CREATE INDEX IF NOT EXISTS idx_homework_parent
  ON homework_assignments(parent_assignment_id);

-- ─── 4. updated_at trigger ──────────────────────────────────────────────────

CREATE TRIGGER t_homework_assignments_upd
  BEFORE UPDATE ON homework_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 5. Row Level Security ──────────────────────────────────────────────────

ALTER TABLE homework_assignments ENABLE ROW LEVEL SECURITY;

-- Admin / moderator: full access
CREATE POLICY "admin_mod_homework" ON homework_assignments
  FOR ALL USING (is_admin_or_mod());

-- Teacher: full CRUD on own assignments
CREATE POLICY "teacher_homework" ON homework_assignments
  FOR ALL USING (teacher_id = auth.uid());

-- Student: read own assignments
CREATE POLICY "student_read_homework" ON homework_assignments
  FOR SELECT USING (student_id = auth.uid());

-- Student: update own assignments (for marking ready)
CREATE POLICY "student_update_homework" ON homework_assignments
  FOR UPDATE USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- ─── 6. Migration record ───────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES ('10.2.0', 'V10: Homework assignments system with state machine, grading, auto-regeneration')
ON CONFLICT DO NOTHING;

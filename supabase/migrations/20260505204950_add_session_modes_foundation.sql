-- Stage 1 / Track A — Session Modes Foundation
--
-- Adds the data structures that let FURQAN sessions exist in three modes:
--   - private   (1 teacher + 1 student, the existing behavior)
--   - halaqa    (1 teacher + N students, group recitation circle)
--   - lecture   (1 broadcaster + many listeners; built only if Stage 7 ships)
--
-- ZERO behavior change. This migration is additive only:
--   - new ENUMs (session_mode, participant_role, attendance_status)
--   - new columns on `sessions` with conservative defaults so legacy rows
--     keep working unchanged
--   - new `session_participants` table for halaqa enrollment
--   - NO RLS policies yet (Stage 2 owns the policy work)
--   - NO INSERT/UPDATE on existing rows
--
-- Naming notes:
--   * `session_type` is ALREADY an enum in this DB — it's the Quranic
--     SUBJECT of a session (hifz / tajweed / muraja / tilawa / qiraat /
--     tafsir / combined / other) and lives on bookings + sessions today.
--     We deliberately use `session_mode` for the new group-structure
--     discriminator to avoid colliding with the existing concept.
--   * `sessions` already has `is_group BOOLEAN` and `capacity INTEGER`
--     from the original schema. We KEEP those — `session_mode` is the
--     finer-grained discriminator (is_group can't tell halaqa from
--     lecture); `capacity` is the existing upper bound and we don't add
--     a duplicate `max_participants`.
--
-- Decisions baked in (from critique of FURQAN_SESSION_MODES_MIGRATION_PLAN.md):
--   1. participant_role enum has ONLY 'teacher' and 'student'.
--      'observer' is intentionally absent — `session_observers` is the
--      canonical observer table and stays separate (avoids dual write paths).
--   2. session_participants is halaqa-scoped. Private sessions still
--      derive participants from bookings (1:1 cardinality preserved).
--      Stage 2 RLS will route by session_mode so each flow reads its own
--      canonical source.
--   3. session_participants.booking_id is NULLABLE. Stage 5 booking flow
--      decides whether halaqa enrollment also writes a per-student booking
--      row; either pattern fits.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. New ENUMs
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE session_mode AS ENUM ('private', 'halaqa', 'lecture');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE participant_role AS ENUM ('teacher', 'student');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM (
    'registered', 'attended', 'absent', 'late', 'left_early'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Extend sessions table
-- ─────────────────────────────────────────────────────────────────────────

-- Group-structure discriminator. Default = 'private' so every existing row
-- receives the correct value automatically — no UPDATE on live rows.
-- Coexists with existing `is_group` boolean (which we leave alone for
-- backward compat) and `session_type` enum (Quranic subject — different
-- concept).
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_mode session_mode NOT NULL DEFAULT 'private';

-- Capacity floor + current enrollment. `capacity` is the existing upper
-- bound (already on sessions); we add the lower bound + a counter.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS min_participants INTEGER NOT NULL DEFAULT 1 CHECK (min_participants >= 1);
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS current_enrollment INTEGER NOT NULL DEFAULT 0 CHECK (current_enrollment >= 0);

-- Recording: opt-in per session. Default false keeps current privacy
-- semantics; halaqas with permission can flip this on.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS allow_recording BOOLEAN NOT NULL DEFAULT FALSE;

-- Quranic context. Useful for halaqa lesson plans + future lecture
-- registration cards. All optional.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS surah_reference TEXT;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS ayah_range TEXT;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_topic_ar TEXT;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_topic_en TEXT;

-- Daily.co room mode. 'default' is the existing 1:1 room shape. Stage 2
-- room creation will branch on session_mode to set this to 'group' for
-- halaqa or 'broadcast' for lecture, and write the resulting Daily room
-- properties accordingly. Kept as TEXT (not a fourth enum) to leave room
-- for Daily-side mode names changing without a migration.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS daily_room_mode TEXT NOT NULL DEFAULT 'default';

-- Index the discriminator — Stage 2 RLS, Stage 4 dashboards, and Stage 5
-- browse-halaqas all filter by it.
CREATE INDEX IF NOT EXISTS idx_sessions_session_mode ON sessions(session_mode);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. session_participants table
-- ─────────────────────────────────────────────────────────────────────────
--
-- Halaqa-scoped enrollment record. One row per (session, user) pair.
-- Private sessions continue to use the existing bookings linkage and DO
-- NOT have rows here. Stage 2 RLS layers a session_mode check so each
-- flow reads its own canonical source.

CREATE TABLE IF NOT EXISTS session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role participant_role NOT NULL,
  attendance_status attendance_status NOT NULL DEFAULT 'registered',
  -- Capture how the participant ended up in the session — useful for
  -- attendance reports and refund logic in Stage 5 cancellation flow.
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  -- Daily.co meeting token for this participant in this session. Issued
  -- by Stage 2 token-generation service; rotated per session.
  daily_token TEXT,
  -- Optional booking. Stage 5 may attach the student's booking row here
  -- for teacher payout / scheduling — left nullable until that decision
  -- lands so the schema doesn't pre-commit.
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  -- Free-text per-participant notes (teacher's call: "needs gentle correction
  -- on tashkeel in surah X" etc). Not surfaced to other students.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A user can only enroll once per session — second enrollment must
  -- update the existing row instead of duplicating.
  UNIQUE (session_id, user_id)
);

-- Reuse the existing set_updated_at() trigger function (defined in
-- v9_001_schema.sql, used across the schema for any table with an
-- updated_at column).
CREATE TRIGGER set_session_participants_updated_at
  BEFORE UPDATE ON session_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_session_participants_session
  ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user
  ON session_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_role
  ON session_participants(role);

-- Enable RLS on the new table immediately. Stage 2 will add the
-- specific policies. Until Stage 2 ships, only service_role can
-- read/write — which is exactly what we want during the schema-only
-- phase (no client code reads this table yet).
ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Documentation comments
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN sessions.session_mode IS
  'Group-structure discriminator: private | halaqa | lecture. NOT to be confused with `session_type` (Quranic subject). Defaults to private; controls room creation mode + RLS path in Stage 2.';

COMMENT ON COLUMN sessions.daily_room_mode IS
  'Daily.co room shape. ''default'' for private, ''group'' for halaqa, ''broadcast'' for lecture. Set by Stage 2 room creation service.';

COMMENT ON TABLE session_participants IS
  'Halaqa enrollment records. NOT used for legacy private sessions (those derive participants from bookings) or for admin observation (session_observers is canonical). Stage 2 will add RLS; Stage 5 begins writing rows on halaqa enrollment.';

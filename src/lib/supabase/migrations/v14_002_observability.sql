-- ============================================================================
-- V14.2: Observability Tables
-- automation_dead_letter: failed automation tasks that must not be lost
-- session_presence_events: granular join/leave tracking for no-show/lateness
-- ============================================================================

-- ─── automation_dead_letter ────────────────────────────────────────────────
-- When an automation workflow fails after all retries, the task lands here
-- for admin review. Do NOT drop rows — they are the operational record.

CREATE TABLE IF NOT EXISTS public.automation_dead_letter (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name     text        NOT NULL,
  event_name        text,
  entity_type       text,
  entity_id         uuid,
  idempotency_key   text,
  payload_json      jsonb,
  last_error        text,
  attempt_count     integer     NOT NULL DEFAULT 1,
  first_failed_at   timestamptz NOT NULL DEFAULT now(),
  last_failed_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid        REFERENCES profiles(id),
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_unresolved
  ON automation_dead_letter(last_failed_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dead_letter_workflow
  ON automation_dead_letter(workflow_name);
CREATE INDEX IF NOT EXISTS idx_dead_letter_entity
  ON automation_dead_letter(entity_type, entity_id);

ALTER TABLE automation_dead_letter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_mod_dead_letter"
  ON automation_dead_letter FOR ALL
  USING (is_admin_or_mod());

-- ─── session_presence_events ───────────────────────────────────────────────
-- Granular attendance log. Each join/leave by each participant is one row.
-- Used by no-show detector, lateness metrics, teacher punctuality KPIs.

CREATE TABLE IF NOT EXISTS public.session_presence_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES profiles(id),
  event_type   text        NOT NULL CHECK (event_type IN ('joined', 'left', 'rejoined', 'disconnected')),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  client_info  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_session
  ON session_presence_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_presence_user
  ON session_presence_events(user_id, occurred_at DESC);

ALTER TABLE session_presence_events ENABLE ROW LEVEL SECURITY;

-- Participants can read their own presence rows
CREATE POLICY "self_read_presence"
  ON session_presence_events FOR SELECT
  USING (user_id = auth.uid());

-- Session participants can read all rows for that session
CREATE POLICY "session_participants_read_presence"
  ON session_presence_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
      JOIN bookings b ON b.id = s.booking_id
      WHERE s.id = session_presence_events.session_id
        AND (b.student_id = auth.uid() OR b.teacher_id = auth.uid())
    )
  );

-- Admin/moderator full access
CREATE POLICY "admin_mod_presence"
  ON session_presence_events FOR ALL
  USING (is_admin_or_mod());

INSERT INTO schema_migrations (version, description)
VALUES ('14.2.0', 'V14.2: Observability tables — automation_dead_letter + session_presence_events')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- V14.5: Phase-1 Admin Dashboard — site announcements + message moderation
--
-- 1. site_announcements: admin-controlled bilingual banner shown at the top of
--    public pages (maintenance notices, Ramadan schedule, new features).
--    One active at a time is expected; if multiple overlap, layout renders
--    the most severe.
--
-- 2. messages.flagged_at/flagged_by/hidden_at/hidden_by: moderation fields
--    so an admin or moderator can hide a message without deleting it.
--    Preserves the audit trail while removing visibility.
-- ============================================================================

-- ─── site_announcements ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_announcements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_ar    text        NOT NULL,
  message_en    text        NOT NULL,
  severity      text        NOT NULL DEFAULT 'info'
                            CHECK (severity IN ('info', 'warning', 'critical')),
  is_dismissible boolean    NOT NULL DEFAULT true,
  active_from   timestamptz NOT NULL DEFAULT now(),
  active_until  timestamptz,
  cta_label_ar  text,
  cta_label_en  text,
  cta_href      text,
  created_by    uuid        REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Simple ordering index; the active-window filter runs in the WHERE clause.
-- (Postgres index predicates must be IMMUTABLE; now() isn't.)
CREATE INDEX IF NOT EXISTS idx_site_announcements_active
  ON site_announcements(active_from DESC, active_until DESC NULLS FIRST);

DROP TRIGGER IF EXISTS t_site_announcements_updated ON site_announcements;
CREATE TRIGGER t_site_announcements_updated
  BEFORE UPDATE ON site_announcements
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE site_announcements ENABLE ROW LEVEL SECURITY;

-- Public can read currently-active announcements
CREATE POLICY "public_read_active_announcements"
  ON site_announcements FOR SELECT
  USING (
    active_from <= now()
    AND (active_until IS NULL OR active_until > now())
  );

-- Admins manage
CREATE POLICY "admin_manage_announcements"
  ON site_announcements FOR ALL
  USING (is_admin());

-- ─── messages moderation fields ────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'flagged_at'
  ) THEN
    ALTER TABLE messages
      ADD COLUMN flagged_at timestamptz,
      ADD COLUMN flagged_by uuid REFERENCES profiles(id),
      ADD COLUMN flag_reason text,
      ADD COLUMN hidden_at timestamptz,
      ADD COLUMN hidden_by uuid REFERENCES profiles(id);
  END IF;
END $$;

-- Index for moderation queue: flagged but not yet hidden
CREATE INDEX IF NOT EXISTS idx_messages_flagged_open
  ON messages(flagged_at DESC)
  WHERE flagged_at IS NOT NULL AND hidden_at IS NULL;

INSERT INTO schema_migrations (version, description)
VALUES ('14.5.0', 'V14.5: Phase-1 admin — site_announcements + messages moderation fields')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- V13: Communication Infrastructure
-- message_delivery_log + communication_preferences tables
-- ============================================================================

-- ─── 1. message_delivery_log ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.message_delivery_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id    uuid        NOT NULL REFERENCES profiles(id),
  recipient_channel    text        NOT NULL CHECK (recipient_channel IN ('in_app','email','whatsapp','telegram','sms')),
  template_name        text,
  related_entity_type  text,
  related_entity_id    uuid,
  status               text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed')),
  provider_message_id  text,
  attempted_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at         timestamptz,
  failed_at            timestamptz,
  failure_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_recipient ON message_delivery_log(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_log_status ON message_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_delivery_log_entity ON message_delivery_log(related_entity_id);

ALTER TABLE message_delivery_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_mod_read_delivery_log" ON message_delivery_log FOR SELECT USING (is_admin_or_mod());

-- ─── 2. communication_preferences ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.communication_preferences (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL UNIQUE REFERENCES profiles(id),
  preferred_language  text        NOT NULL DEFAULT 'ar' CHECK (preferred_language IN ('ar','en','bilingual')),
  email_enabled       boolean     NOT NULL DEFAULT true,
  whatsapp_enabled    boolean     NOT NULL DEFAULT true,
  in_app_enabled      boolean     NOT NULL DEFAULT true,
  quiet_hours_start   time,
  quiet_hours_end     time,
  important_only_mode boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER t_comm_prefs_upd
  BEFORE UPDATE ON communication_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own_prefs" ON communication_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_update_own_prefs" ON communication_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_insert_own_prefs" ON communication_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_mod_all_prefs" ON communication_preferences FOR ALL USING (is_admin_or_mod());

-- ─── 3. Migration record ────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES ('13.1.0', 'V13: Communication infrastructure — delivery logs + preferences')
ON CONFLICT DO NOTHING;

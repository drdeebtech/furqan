-- Fix sync_conv_ts() to bypass RLS when updating conversations.last_message_at.
--
-- Why: The 2026-05-05 process audit caught messages landing correctly into the
-- `messages` table but the conversation's `last_message_at` staying NULL. Root
-- cause: `sync_conv_ts()` runs as the inserting user (no SECURITY DEFINER),
-- and the conversations RLS policy `conv_admin_update` restricts UPDATE to
-- `private.is_admin_or_mod()` only. So when a student or teacher sends a
-- message, the trigger's UPDATE silently affects 0 rows — RLS doesn't error,
-- it just filters.
--
-- Downstream impact: conversation list ordering by last_message_at, unread
-- "since" badges, retention-signal analytics, and the n8n `inactivity` and
-- `at-risk` workflows all see stale/NULL last_message_at.
--
-- Fix: make the trigger function SECURITY DEFINER so it runs with the
-- function-owner's privileges and bypasses RLS for the timestamp update.
-- The set search_path is already there — we re-set it explicitly to satisfy
-- the supabase-lint rule that SECURITY DEFINER functions must pin search_path.
--
-- Backfill: same logic applied to existing conversations so list ordering
-- starts working immediately for the conversations that already have messages
-- but a NULL last_message_at.

CREATE OR REPLACE FUNCTION public.sync_conv_ts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

-- Backfill: set last_message_at to MAX(messages.created_at) per conversation
-- for any conversation that has messages but a NULL or stale last_message_at.
UPDATE conversations c
SET last_message_at = sub.most_recent
FROM (
  SELECT conversation_id, MAX(created_at) AS most_recent
  FROM messages
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id
  AND (c.last_message_at IS NULL OR c.last_message_at < sub.most_recent);

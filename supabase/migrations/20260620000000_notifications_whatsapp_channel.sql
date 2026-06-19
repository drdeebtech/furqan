-- 20260620000000_notifications_whatsapp_channel.sql
--
-- Spec 023 (م٦) — widen the existing notifications.channel CHECK to include
-- 'whatsapp'. The column is already text[]; this migration only widens the
-- allowed-values set. Existing rows already satisfy the widened set; no data
-- migration needed.
--
-- Constitution compliance: additive only (no new table, no RLS change, no
-- service-role expansion). The <@ subset form (not scalar = ANY) is the
-- canonical pattern — verified 2026-06-16 in Clarifications §"channel
-- widening". Idempotent.

alter table public.notifications
  drop constraint if exists notifications_channel_check;

alter table public.notifications
  add constraint notifications_channel_check
  check (channel <@ array['in_app'::text, 'email'::text, 'push'::text, 'whatsapp'::text]);

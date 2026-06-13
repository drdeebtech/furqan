-- Extend message_delivery_log.status CHECK constraint with 'throttled'.
--
-- Why: the n8n callback now rate-limits notify actions per recipient. When
-- a notify is dropped, we still log the attempt with status='throttled' so
-- admins can see suspicious traffic patterns. 'throttled' is semantically
-- distinct from 'failed' (failed = delivery error; throttled = we refused
-- to send), so it gets its own status value.

ALTER TABLE public.message_delivery_log
  DROP CONSTRAINT IF EXISTS message_delivery_log_status_check;

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_status_check
  CHECK (status IN ('pending','sent','delivered','failed','throttled'));

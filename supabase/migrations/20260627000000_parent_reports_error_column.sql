-- #548: parent_reports needs an `error` column to record delivery failures.
--
-- Background: parent_reports.sent_at was set at INSERT time claiming the
-- report was "sent", but nothing was actually delivered to the parent —
-- the app deferred to n8n workflows that may not exist. The fix wires a
-- direct Resend email dispatch: insert with sent_at NULL, send, then set
-- sent_at on success OR record the failure here. This column is the
-- failure ledger; a non-null value means "attempted, failed, see message".
--
-- Nullable, no default, no NOT NULL constraint (existing rows pre-date the
-- dispatch step and legitimately have no error). No index — failures are
-- rare and ops query by sent_at IS NULL AND error IS NOT NULL, which a
-- partial index could serve but isn't warranted at current scale.

alter table public.parent_reports
  add column if not exists error text;

comment on column public.parent_reports.error is
  'Delivery failure message (e.g. Resend error). Non-null = last send attempt failed; sent_at stays NULL. Cleared on a successful retry.';

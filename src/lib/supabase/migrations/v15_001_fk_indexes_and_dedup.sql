-- v15_001: senior-engineer audit fixes
-- 1. Add supporting indexes for 13 FK columns currently lacking them.
--    These don't hurt at current scale (table sizes are tiny, Postgres
--    chooses seq scan anyway), but they kick in once tables exceed ~1k rows.
-- 2. Drop two duplicate indexes whose pair is fully used and this twin is unused.
--    Each duplicate doubled the write cost on its column.

-- ─── FK supporting indexes ────────────────────────────────────────────────
create index if not exists idx_dead_letter_resolved_by on automation_dead_letter(resolved_by);
create index if not exists idx_bookings_cancelled_by on bookings(cancelled_by);
create index if not exists idx_bookings_created_by on bookings(created_by);
create index if not exists idx_bookings_refund_policy on bookings(refund_policy_id);
create index if not exists idx_bookings_rescheduled_from on bookings(rescheduled_from);
create index if not exists idx_conversations_initiated_by on conversations(initiated_by);
create index if not exists idx_homework_session on homework_assignments(session_id);
create index if not exists idx_messages_flagged_by on messages(flagged_by);
create index if not exists idx_messages_hidden_by on messages(hidden_by);
create index if not exists idx_messages_sender on messages(sender_id);
create index if not exists idx_platform_settings_updated_by on platform_settings(updated_by);
create index if not exists idx_session_notes_saved_by on session_notes_history(saved_by);

-- ─── Drop duplicate indexes ──────────────────────────────────────────────
-- idx_conv_teacher (0 scans) is a duplicate of idx_conversations_teacher (40 scans)
drop index if exists public.idx_conv_teacher;
-- idx_messages_conv (0 scans) is a duplicate of idx_messages_conversation (36 scans)
drop index if exists public.idx_messages_conv;

insert into schema_migrations (version, description)
  values ('v15_001', 'V15.1: FK supporting indexes (12 columns) + drop 2 duplicate indexes')
  on conflict do nothing;

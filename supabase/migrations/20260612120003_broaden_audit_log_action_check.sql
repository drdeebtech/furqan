-- Fix 3.2 (spec 012 P2): broaden audit_log_action_check to allow webhook actions.
--
-- The CHECK only allowed INSERT/UPDATE/DELETE/LOGIN/LOGOUT, but webhook RPCs emit:
--   start_session_from_webhook → 'session.webhook.started'
--   end_session_from_webhook   → 'session.webhook.ended'
--                               → 'session.webhook.reconciled'
--                               → 'session.webhook.misclick_filtered'
--                               → 'session.webhook.ended_on_cancelled'
-- Action strings extracted from pg_get_functiondef on 2026-06-12.

alter table public.audit_log
  drop constraint if exists audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
  check (action = any (array[
    'INSERT',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'session.webhook.started',
    'session.webhook.ended',
    'session.webhook.reconciled',
    'session.webhook.misclick_filtered',
    'session.webhook.ended_on_cancelled'
  ]));

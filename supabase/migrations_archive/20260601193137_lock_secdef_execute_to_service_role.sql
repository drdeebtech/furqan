-- 20260601193137_lock_secdef_execute_to_service_role.sql
--
-- Platform-wide EXECUTE lockdown for server-only SECURITY DEFINER functions
-- (security audit, follow-up to #369).
--
-- Background: Supabase default privileges grant EXECUTE on new public functions
-- directly to `anon` + `authenticated`. For a SECURITY DEFINER function (runs as
-- owner, bypasses RLS) that is only ever invoked server-side, that default grant
-- is an authorization-bypass primitive — any logged-in/anonymous user can call
-- it via POST /rest/v1/rpc/<fn>.
--
-- Each function below was audited (2026-06-01) for its real caller:
--   - trigger-only (EXECUTE is NOT needed for trigger firing — verified on local
--     PG: an authenticated user with no EXECUTE still fires the trigger and
--     cannot rpc it): deduct_student_package, restore_student_package,
--     check_homework_chain_depth, enforce_homework_update_rules
--   - admin/service-role rpc only: deduct_package_session (ledger.ts),
--     end_session_from_webhook + start_session_from_webhook (daily webhook
--     handler, createAdminClient)
--   - defined-but-unused: deduct_package_session_mode, refund_package_session
--
-- DELIBERATELY NOT TOUCHED (genuinely called by the authenticated user-context
-- client and must stay executable):
--   - search_teachers(text,int,int)   — admin/teachers/page.tsx (supabase.rpc)
--   - profiles_role_counts()          — admin/users/page.tsx     (supabase.rpc)
-- (Both are already anon=false; appropriate posture.)
--
-- Also already locked elsewhere: end_session_with_booking (#369),
-- confirm_booking_with_session (auth already revoked).

do $$
declare
  v_fn text;
  v_fns text[] := array[
    'public.deduct_student_package()',
    'public.restore_student_package()',
    'public.check_homework_chain_depth()',
    'public.enforce_homework_update_rules()',
    'public.deduct_package_session(uuid)',
    'public.deduct_package_session_mode(uuid, text)',
    'public.refund_package_session(uuid)',
    'public.end_session_from_webhook(uuid, timestamptz, integer, integer, text, text, text, jsonb)',
    'public.start_session_from_webhook(uuid, timestamptz, text, text, jsonb)'
  ];
begin
  foreach v_fn in array v_fns loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;

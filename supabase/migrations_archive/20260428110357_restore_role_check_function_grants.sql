-- Restore EXECUTE on role-check helper functions for authenticated + anon.
--
-- Background:
-- Two earlier migrations on 2026-04-28 revoked EXECUTE on is_admin(),
-- is_admin_or_mod(), and is_moderator() — first from `anon, authenticated`
-- (20260428095637_hardening_security_definer_and_rls.sql, lines 267-269),
-- then from `public` (20260428102110_revoke_execute_from_public_on_secdef.sql,
-- lines 17-19). The combined effect is that no authenticated user can call
-- these functions.
--
-- The intent of those revokes was to harden SECURITY DEFINER functions
-- against direct calls by untrusted roles. But these three specific functions
-- are called by RLS policies on dozens of tables (legal_documents, site_faqs,
-- site_features, site_blog_categories, teacher_picklists, retention_signals,
-- automation_logs, packages, and more — see grep "is_admin\|is_moderator" in
-- src/lib/supabase/migrations/). When the RLS evaluator can't call the
-- function, every query against those tables fails with:
--   ERROR: permission denied for function is_admin
-- which is exactly what auth_audit_logs caught at 2026-04-28T11:00:49.
--
-- Fix: re-grant EXECUTE on the three role-check functions to anon and
-- authenticated. They are SECURITY DEFINER, so the function body still runs
-- with owner privileges — granting EXECUTE only allows the boolean result to
-- be returned, not any escalation.
--
-- Anon needs EXECUTE because some RLS policies are evaluated for anon traffic
-- (public-read tables like site_faqs and teacher_picklists where reads are
-- gated by `is_active` but writes are gated by `is_admin()`; Postgres may
-- evaluate the admin policy as part of the OR-combined RLS check).
--
-- Other revoked functions (handle_new_user, ensure_teacher_profile,
-- sync_teacher_archive_with_profile) are trigger-only and don't need
-- EXECUTE granted — leaving them revoked is correct.

grant execute on function public.is_admin()        to anon, authenticated;
grant execute on function public.is_admin_or_mod() to anon, authenticated;
grant execute on function public.is_moderator()    to anon, authenticated;

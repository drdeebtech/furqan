-- Lock down EXECUTE on ai_review_gate(text).
--
-- The original migration (20260625150839_ai_review_gate_fn.sql) did
-- `revoke execute ... from anon`, but CREATE FUNCTION grants EXECUTE to the
-- pseudo-role PUBLIC by default. Revoking from the named role `anon` (which
-- never held an explicit grant) is a no-op: anon AND authenticated both retain
-- EXECUTE via PUBLIC. This SECURITY DEFINER function reads admin-only
-- `ai_output_review` (aggregate approved/rejected counts per workflow), so the
-- ineffective revoke left that data readable by any caller — a bypass of the
-- table's `using (is_admin())` RLS.
--
-- The only caller is src/lib/actions/admin-ai-review.ts, which invokes it on the
-- service-role admin client (service_role bypasses RLS but needs an explicit
-- EXECUTE grant once PUBLIC is revoked). Revoke from PUBLIC/anon/authenticated
-- and grant to service_role only.
--
-- Expand/contract-safe: no live anon/authenticated path calls this function, and
-- the sole service-role caller keeps its grant, so the running build is unaffected.

revoke execute on function public.ai_review_gate(text) from public, anon, authenticated;
grant execute on function public.ai_review_gate(text) to service_role;

# 014 — Plan

**Status:** Shipped via #458. This plan is the close-out record; no further work needed.

## What shipped

Migration `supabase/migrations/20260613120000_session_participant_secdef.sql` (in #458) converts `public.user_is_session_participant(s_id uuid)` from SECURITY INVOKER to SECURITY DEFINER, body byte-identical except for the security flip + `SET search_path TO 'pg_catalog', 'public'`.

## Why

The `sessions_select_via_participants_v2` policy calls `user_is_session_participant(id)`. Under INVOKER, the function's read of `session_participants` was subject to that table's RLS, which in turn subqueried `sessions` — the shape flagged as a 42P17 recursion risk. Under DEFINER, the inner SELECT bypasses RLS and the helper returns the membership boolean without re-entering the policy chain.

## Verification (2026-06-13, live local replica — from original spec)

- Two-direction test (INVOKER vs DEFINER) raised no 42P17 on this Postgres version.
- `sp_select_self_or_teacher_or_admin`'s first clause `user_id = auth.uid()` means under INVOKER the helper already saw the caller's own participant row — so the fix is hardening, not a live-bug fix. Confirmed correct results either way.
- Downgraded from "live bug" to "defense-in-depth" in the original spec; shipped anyway because the recursion risk is real on other Postgres versions and the cost is zero.

## Re-verification (2026-06-18, on `014-session-participant-secdef` branch)

```
\df+ public.user_is_session_participant
→ Security: definer
```

`tsc --noEmit`: clean (no TS touched).

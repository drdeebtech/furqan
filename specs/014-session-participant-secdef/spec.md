# 014 — `user_is_session_participant` → SECURITY DEFINER (spec 012 P1 2.5)

**Status:** Shipped via [#458](https://github.com/drdeebtech/furqan/pull/458) (refactor/follow-up-collapse) — verified 2026-06-18. Close-out PR: [#483](https://github.com/drdeebtech/furqan/pull/483).
**Feature Branch:** `014-session-participant-secdef`
**Type:** security fix (RLS helper). **Date:** 2026-06-13
**Lenses:** 🔒 security (primary) · 🛠 engineer (RLS recursion correctness)
**Origin:** last open P1 from [[012-prod-rls-hardening]] §2.5, verified live 2026-06-13.

## Problem (verified against the live local replica)

`public.user_is_session_participant(s_id uuid)` is **`SECURITY INVOKER`** (`prosecdef = f`):

```sql
CREATE OR REPLACE FUNCTION public.user_is_session_participant(s_id uuid)
  RETURNS boolean LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.session_participants
       WHERE session_id = s_id AND user_id = auth.uid()); $$;
```

It is called by the `sessions` SELECT policy `sessions_select_via_participants_v2`
(`USING user_is_session_participant(id)`). Because it runs as the **invoker**, its read of
`session_participants` is subject to that table's RLS, and `session_participants`'
`sp_select_self_or_teacher_or_admin` policy subqueries `sessions` again — the shape CodeRabbit
flagged as a recursion / wrong-eval risk.

**Verification verdict (2026-06-13, live local replica) — downgraded to hardening, not a live bug:**
- A two-direction test (function forced to SECURITY INVOKER vs. DEFINER, same authenticated
  `SELECT … FROM sessions`) raised **no `42P17`** on this Postgres version and returned **identical
  results** either way. The predicted infinite recursion is **not reproducible** here.
- `sp_select_self_or_teacher_or_admin`'s first clause is `user_id = auth.uid()`, so under INVOKER the
  helper already sees the caller's own participant row and returns the **correct** membership boolean.
  No behavioral difference in the current schema.

So this is **defense-in-depth, not a live exploit fix**: it (a) matches the security-sensitive
`private.is_admin` helper (also DEFINER), (b) future-proofs against later `sp_*` policy changes that
could introduce real recursion, and (c) avoids re-evaluating `session_participants` RLS on every
session-visibility check (perf). Zero behavioral change — kept as low-risk hardening, not P1.

## Fix

Make the helper **`SECURITY DEFINER`** so its internal read of `session_participants` bypasses that
table's RLS, breaking the loop. This is the canonical Supabase pattern for RLS helper functions
(same posture as `is_admin` / `is_admin_or_mod`). No signature, behavior, or return-type change.

## Constraints (from [[012-prod-rls-hardening]] §0 + repo rules)

- New **forward migration** only; timestamp **after** the baseline (`20260428000000`). Never edit the
  baseline or anything under `supabase/migrations_archive/`.
- Keep `LANGUAGE sql`, `STABLE`, and **`SET search_path = pg_catalog, public`** (locked path — required
  for SECURITY DEFINER hardening; do not widen, do not set empty).
- `CREATE OR REPLACE` (idempotent); do **not** drop the function (policies depend on it).
- No `db push` in this task — local verify only; prod push stays gated on the password rotation
  ([[project_db_password_rotation_deferred]]).

## Acceptance / local verification (run after `supabase db reset`)

1. `SELECT prosecdef FROM pg_proc WHERE proname='user_is_session_participant';` → **`t`**.
2. Function still `STABLE`, `LANGUAGE sql`, `search_path = pg_catalog, public` (unchanged).
3. As an authenticated participant, `SELECT … FROM sessions` returns their session rows with **no
   42P17** error; a non-participant sees 0 of those rows (membership eval correct).
4. `npx tsc --noEmit` and `supabase db reset` both clean (migration applies in order).

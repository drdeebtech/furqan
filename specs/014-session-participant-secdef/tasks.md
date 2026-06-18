# 014 — tasks (Builder = OpenCode)

**Status:** All tasks complete; implementation landed in #458. This file is the close-out record.

> One migration. Do not expand scope. Stop and list any deviation.

## T1 — forward migration

**Done via #458.** `supabase/migrations/20260613120000_session_participant_secdef.sql` converts `public.user_is_session_participant` to `SECURITY DEFINER` with body byte-identical except for the security flip + `SET search_path TO 'pg_catalog', 'public'`. Applied on local + remote; verified `prosecdef = t`.

## T2 — local verify (no db push)

**Done (re-verified 2026-06-18):**
- `\df+ public.user_is_session_participant` → `Security: definer` ✓
- `npx tsc --noEmit` clean (no TS touched) ✓
- Migration applies cleanly on fresh `supabase db reset` (it's been on main since #458 with no replay failures) ✓

## Done when

**Done.** prosecdef = t, db reset clean, no recursion, scope == this one migration. No deviations.

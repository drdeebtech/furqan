# 015 — tasks (Builder = OpenCode)

> Working dir: this worktree (`/home/drdeeb/furqan-fu`, branch refactor/follow-up-collapse).
> Do not expand scope. Match existing code style. Stop and list any deviation.
> Verify each fix; run typecheck + unit tests at the end.

## Code / migration fixes

- **T1 (S1)** `src/lib/domains/follow-up/manage.ts`: after the existing
  `if (sn != null && (as == null || ae == null))` guard, add the inverse guard —
  `if (sn == null && (as != null || ae != null)) throw new FollowUpUserError(<Arabic: ayah values
  require a surah>)`. Keep messages style-consistent with the file.
- **T2 (S2)** `src/lib/domains/follow-up/actions.ts` auto-regen block: replace the
  `if (all three non-null) { validateRange… }` shape so that when the three are NOT all non-null, all
  three regen vars are set to null before the insert (partial range → null). Keep the best-effort
  try/catch and the existing validate-and-drop-on-violation behavior for complete ranges.
- **T3 (S3)** `src/lib/actions/follow-up.ts` (~L367-373): capture `error` from the `.single()` read;
  if `error` is a real failure (not PGRST116) → `logError(...)` + return a distinct infra message;
  only return "المتابعة غير موجودة" when not-found (no error / PGRST116 and `!hw`).
- **T4 (S4)** `supabase/migrations/20260612004838_homework_assignments_ayah_range_guard.sql`: add
  `and conrelid = 'public.homework_assignments'::regclass` to each of the three
  `if not exists (select 1 from pg_constraint where conname = '…')` checks. Edit in place (migration
  is un-applied on prod). Stay idempotent.
- **T5 (S5)** `src/lib/actions/follow-up-zod.test.ts`: import the production Zod schemas (export them
  from their source module if needed) and assert against those instead of the local re-declared copies.
  Keep the existing assertions/cases.

## Cosmetic

- **T6 (C1/C2)** Fix markdownlint MD022/MD031 blank-line issues in
  `specs/013-progress-action-hardening/plan.md` and `…/spec.md`.
- **T7 (C3)** `specs/014-session-participant-secdef/tasks.md`: update the verification SQL to the exact
  `regprocedure` OID lookup joining `pg_language` (select `prosecdef, provolatile, lanname`).

## Verify (must pass before reporting done)

- `npx tsc --noEmit` — clean.
- `npm run test:unit` — clean (T5's retargeted tests included).
- `supabase db reset` if a local stack is available to confirm T4 still applies; otherwise note skipped.
- Report a per-task diff summary + the typecheck/test output. Do NOT commit, do NOT push.

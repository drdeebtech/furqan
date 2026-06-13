# 017 — tasks (Builder = OpenCode)

> Working dir: this worktree (/home/drdeeb/furqan-r2, branch refactor/follow-up-collapse).
> Do not touch the baseline or migrations_archive/. No db push. Match existing style (Arabic
> messages, immutability, no `any`). Stop and list any deviation.

## T2 — booking identity-column lock (MONEY CRITICAL) — forward migration
Create `supabase/migrations/20260613140000_guard_booking_identity_change.sql`:
- `create or replace function private.guard_booking_identity_change() returns trigger language plpgsql security definer set search_path to 'public'` that, when
  `new.teacher_id is distinct from old.teacher_id or new.student_id is distinct from old.student_id`,
  and the JWT role (`nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'`) is not
  null and not `'service_role'`, and `not private.is_admin()`, raises
  `'only an admin may change booking parties' using errcode = '42501'`; else `return new`.
- `drop trigger if exists t_guard_booking_identity_change on public.bookings;`
  `create trigger t_guard_booking_identity_change before update of teacher_id, student_id on public.bookings for each row execute function private.guard_booking_identity_change();`
- Idempotent; mirrors `20260612120000_guard_profiles_role_escalation.sql`.

## T1 — createFollowUp: derive/verify student_id + session_id from the booking
In `src/lib/domains/follow-up/actions.ts` `createFollowUp`: extend the booking select to
`teacher_id, student_id`; after the ownership check, use `booking.student_id` for the insert AND for
`dispatchEffects` (do NOT trust `input.studentId`) — or reject if `input.studentId !== booking.student_id`.
For `session_id`: if non-null, verify it belongs to `input.bookingId` (select sessions by booking_id /
the session's booking_id), reject mismatch with `FollowUpUserError`. Keep behavior identical for valid input.

## T3 — bound ayahNum to the surah ayah count (progress errors)
In the session-progress action path (`src/app/teacher/sessions/[id]/actions.ts` / its validation), after
schema parse, validate each `errors[]` entry: reject when `surahNum` is invalid or `ayahNum < 1` or
`ayahNum > ayahCount(surahNum)` (use the canonical helper in `src/lib/quran`, e.g. `ayahCount`). Arabic
error message. Do not alter valid behavior.

## T4 — validateHomeworkRange rejects partial ranges
In `src/lib/domains/progress/validation.ts` `validateHomeworkRange`: when `surahNumber != null`, require
both `ayahStart != null` and `ayahEnd != null` (reject one-bound-missing with an Arabic message);
`(null,null,null)` stays valid; full valid range unchanged. Also add a DB CHECK (in the existing
`20260612004838_homework_assignments_ayah_range_guard.sql` do-block, idempotent, conrelid-scoped)
`homework_ayah_both_or_neither` = `check ((ayah_start is null) = (ayah_end is null))` so one missing
bound is rejected at the DB layer too.

## Verify before reporting
- `supabase db reset` clean.
- T2 repro (psql, rolled back): simulate a student same-status update setting teacher_id/student_id →
  then status→confirmed → must hit 42501 from the new trigger. Service-role/admin path still works.
- T4: `validateHomeworkRange(1,null,5)` returns a non-null error; `(1,1,5)` and `(null,null,null)` return null.
- `npx tsc --noEmit` + `npm run test:unit` clean.
- Report per-task diffs + outputs. Do NOT commit, do NOT push.

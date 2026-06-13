# 017 — PR #458 cursor[bot] authz/integrity findings (verified)

**Type:** security/integrity remediation. **Date:** 2026-06-13. **Branch:** refactor/follow-up-collapse (#458).
**Lenses:** 🔒 security (T1/T2) · 📖 Quran integrity (T3/T4) · 🛠 engineer.
**Origin:** 4 unresolved cursor[bot] review threads blocking merge (conversation-resolution required).
**All verified live against branch HEAD `db4e011` before inclusion.**

## T2 — `bookings_update` lets a student rewrite booking parties (MONEY CRITICAL)
`bookings_update` = `USING (auth.uid()=student_id OR auth.uid()=teacher_id OR is_admin())` with an
**empty `WITH CHECK`**. A student owning a pending booking can do a same-status UPDATE to set
`teacher_id = auth.uid()` and `student_id = <victim>` (passes USING via old student_id, empty WITH
CHECK, status unchanged so `validate_booking_status` doesn't fire), then UPDATE `status→confirmed`
(now passes USING via teacher_id and the `old.teacher_id` actor guard) → `deduct_student_package`
fires for the **victim's** package. The spec-012 actor guard (`block_student_booking_self_confirm`)
is bypassed because `teacher_id`/`student_id` are themselves mutable.

**Verified:** no app path ever UPDATEs `bookings.teacher_id`/`student_id` on an existing row (booking
parties are fixed at INSERT; admin reassignment would be service-role). So locking them is safe.

**Fix (forward migration, mirrors spec-012 P0 trigger pattern):** a `BEFORE UPDATE OF teacher_id,
student_id ON public.bookings` trigger `private.guard_booking_identity_change()` (SECURITY DEFINER,
`search_path=public`) that raises `42501` when `new.teacher_id IS DISTINCT FROM old.teacher_id OR
new.student_id IS DISTINCT FROM old.student_id`, unless the JWT role is `service_role` or
`private.is_admin()`. Enumerate-writers rule [[feedback_enumerate_writers_before_rls_guard]]: guard
only the identity columns; bypass service_role/admin.

## T1 — `createFollowUp` trusts client `student_id`/`session_id` into a service-role write (HIGH)
`createFollowUp` (domains/follow-up/actions.ts) verifies only `booking.teacher_id == actor.id`, then
inserts the **client-supplied** `student_id`/`session_id` and notifies that student. A teacher can
forge a follow-up + notification for an unrelated student/session.
**Fix:** select `student_id` (and `booking_id`'s session linkage) from the booking; use the booking's
`student_id` for the insert + `dispatchEffects` (ignore/verify `input.studentId` against it — reject on
mismatch). For `session_id`, verify it belongs to the booking (or derive it); reject mismatches.

## T3 — `ayahNum` in session-progress errors has no upper bound (📖 Medium)
`recordSessionProgressSchema.errors[].ayahNum` is `z.number().int()` (no max); flows through the
service-role `record_student_progress` RPC into `recitation_errors`. A teacher can persist impossible
ayah numbers (9999, -1).
**Fix:** validate each error location against `ayahCount(surahNum)` (use `src/lib/quran`) at the action
boundary — reject `ayahNum < 1` or `ayahNum > ayahCount(surahNum)`, and invalid `surahNum`. (DB backstop
optional/follow-up; app-level validation is the required fix here.)

## T4 — partial homework ranges bypass `validateHomeworkRange` (📖 Medium)
`validateHomeworkRange` returns `null` (valid) when **any** of surah/start/end is null — so
`surah=1, ayahStart=null, ayahEnd=5` passes (createFollowUp path). `editFollowUp` already rejects this;
`createFollowUp` is inconsistent.
**Fix:** in `validateHomeworkRange`, when `surahNumber != null`, require `ayahStart` and `ayahEnd` to be
**both present** (reject one-bound-missing) with an Arabic message; keep all-null (no range) valid.
Also tighten the DB `homework_ayah_order`/add a CHECK so one missing bound is rejected at the DB layer
(both-or-neither for ayah_start/ayah_end), consistent with the existing `homework_ayah_requires_surah`.

## Acceptance (local, after `supabase db reset`)
- T2: as a student, the 2-step rewrite (set teacher_id=self/student_id=victim → confirm) is **rejected
  42501**; legitimate student cancel (pending→cancelled) and service-role/admin updates still work.
- T1: createFollowUp with a mismatched `student_id` (≠ booking's) is **rejected**; matching works.
- T3: a progress error with `ayahNum` beyond the surah's count is **rejected**; valid passes.
- T4: `validateHomeworkRange(1, null, 5)` returns an error; `(1,1,5)` and `(null,null,null)` pass.
- `npx tsc --noEmit`, `npm run test:unit`, `supabase db reset` all clean.

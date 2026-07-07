-- Security hotfix — close the "free session" hole at booking creation.
--
-- FINDING (security review, 2026-07-07; pre-existing, affects ALL bookings —
--   independent of any feature branch). The `bookings_insert` RLS policy only
--   checked `auth.uid() = student_id`. It placed NO constraint on `status` or
--   `student_package_id` at INSERT time, and the only INSERT-firing trigger
--   (t_validate_session_type) doesn't guard them either. The FK on
--   student_package_id requires the row to merely EXIST, not to be the caller's,
--   active, or funded.
--
-- EXPLOIT. An authenticated student, hitting PostgREST directly with their own
--   JWT + the public anon key (no server action), inserts a bookings row with
--   student_id = self, status = 'pending', and student_package_id = one of their
--   OWN lots (RLS lets them read only their own) — e.g. an already-exhausted or
--   expired lot. When the teacher confirms (a normal UPDATE), the confirm-time
--   debit trigger `deduct_student_package` sees `student_package_id IS NOT NULL`,
--   treats the booking as "already charged", and returns WITHOUT deducting. Net:
--   a free 1:1 session, repeatable indefinitely.
--
-- FIX. A non-admin (student-JWT) caller may only create a PENDING booking with
--   NO pre-set student_package_id — the package is resolved and stamped ONLY by
--   the confirm-time trigger. This closes the pre-stamp vector without a trigger
--   change (defense at the INSERT boundary, where it belongs).
--
-- SAFETY (writers enumerated before tightening — every bookings INSERT path):
--   • booking/actions.ts (createBooking), group-session.ts, student/group-
--     sessions/actions.ts, class-offerings.ts → all use the SERVICE-ROLE admin
--     client, which bypasses RLS entirely, so this policy does not touch them.
--     (class-offerings/group legitimately pre-stamp student_package_id +
--     status='confirmed' — allowed, because they run as service_role.)
--   • scheduling/bookings.ts → the only user-scoped-client insert path; it
--     already inserts status='pending' with a NULL student_package_id, so it
--     still satisfies the tightened WITH CHECK.
--   Teachers/others were already unable to student-insert (old policy's
--   student_id branch), so no non-student path regresses.
--
-- Expand/contract: replaces one RLS policy in-transaction (no window without an
--   insert policy); strictly TIGHTENS (never loosens) the check, so the
--   currently-running build — which only ever inserts via service_role or with
--   pending/null — is unaffected. No DDL structural change.

DROP POLICY IF EXISTS bookings_insert ON public.bookings;

CREATE POLICY bookings_insert ON public.bookings
  FOR INSERT
  WITH CHECK (
    (
      auth.uid() = student_id
      AND status = 'pending'
      AND student_package_id IS NULL
    )
    OR (SELECT public.is_admin())
  );

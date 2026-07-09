-- Fix a production P0 in finalize_attendance (spec 019 attendance/payroll).
--
-- BUG. finalize_attendance (20260619000004, carried into 20260714000000) does
--   `PERFORM restore_student_package(p_booking_id)` on the teacher_absent /
--   excused_carried branch. But restore_student_package was only ever defined as
--   a NO-ARG TRIGGER function (baseline 20260428000000: `restore_student_package()
--   RETURNS trigger`, fired by t_restore_student_package AFTER UPDATE OF status ON
--   bookings). No `restore_student_package(uuid)` overload exists anywhere.
--
--   A trigger function with zero declared arguments cannot be invoked as
--   `restore_student_package(<uuid>)`, so the call resolves to a non-existent
--   signature (SQLSTATE 42883). Because the function was created with
--   check_function_bodies=off, the phantom reference was accepted at CREATE time
--   and fails only at RUNTIME — and only on the teacher_absent / excused_carried
--   branch, which the staging verification for #651 never exercised (it walked
--   `present` / payroll only). Net effect in production: finalizing attendance for
--   a teacher-absent (or excused-carried) SUBSCRIPTION/legacy booking raises and
--   the whole finalize_attendance transaction aborts — the student's session
--   credit is never restored.
--
--   (This is the SAME class of latent bug as the three fixed in 20260714000000 /
--   PR #651 — a phantom reference hidden by check_function_bodies=off — that the
--   #651 fix missed because it did not test the restore branch.)
--
-- FIX. Add the missing overload `restore_student_package(p_booking_id uuid)` that
--   the call already expects. It replicates the no-arg trigger's restore contract
--   EXACTLY, keyed by booking id instead of the trigger's NEW row:
--     - credit back one session on the EXACT package charged for this booking
--       (bookings.student_package_id, stamped on deduct per #346),
--     - clamp at 0 (never restore below zero, matching the trigger's guard),
--     - NULL stamp = no package was debited = restore nothing (never re-derive a
--       package — the #363 free-session guard).
--   This is purely additive: it introduces a new function signature; the existing
--   no-arg trigger function and its trigger are untouched. finalize_attendance is
--   unchanged (its call now simply resolves).
--
-- Idempotency: the sole caller (finalize_attendance) already guards single-restore
--   via `v_existing_credit_action IS DISTINCT FROM 'restored'`, so this fn is
--   invoked at most once per booking. The `sessions_used > 0` clamp bounds any
--   accidental repeat. Matching the no-arg trigger, the fn itself is intentionally
--   minimal (not self-idempotent) — the caller owns once-only semantics.
--
-- Expand/contract: ADD FUNCTION only. No DROP/RENAME, no signature change to any
--   existing object, no enum/type/column change. Safe under concurrent migration +
--   Vercel deploy with no ordering gate: the old build never calls this new
--   signature, and the new build gains a working restore.

create or replace function public.restore_student_package(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Credit ONLY the exact package charged for this booking (stamped on deduct,
  -- #346). A NULL stamp means no package was debited -> nothing to restore; do
  -- NOT re-derive a package (that would grant a free session, #363). Clamp >= 0.
  update student_packages sp
  set sessions_used = greatest(sp.sessions_used - 1, 0)
  from bookings b
  where b.id = p_booking_id
    and sp.id = b.student_package_id
    and sp.sessions_used > 0;
end;
$$;

alter function public.restore_student_package(uuid) owner to postgres;

-- Lockdown (repo SECURITY DEFINER pattern, 20260619000004 / 20260714000000):
-- only the SECURITY DEFINER caller (finalize_attendance, run as service_role)
-- invokes this. anon/authenticated must not reach it.
revoke execute on function public.restore_student_package(uuid) from public, anon, authenticated;
grant  execute on function public.restore_student_package(uuid) to service_role;

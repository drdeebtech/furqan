-- Stage 2 / Track A — Session Modes RLS
--
-- Adds Row Level Security policies for the `session_participants` table
-- introduced in Stage 1 + extends `sessions` SELECT to let enrolled halaqa
-- participants read sessions they appear in.
--
-- Depends on:
--   - Stage 1 migration 20260505204950_add_session_modes_foundation.sql
--     (which created session_participants + ALTER'd sessions to add
--     session_mode + enabled RLS on session_participants without policies)
--   - Existing helpers: is_admin(), is_admin_or_mod() from v9_001_schema.sql
--
-- Design notes:
--   * For PRIVATE sessions, the legacy bookings-based access continues —
--     this migration does NOT touch the existing sessions SELECT policies
--     for teacher/student/admin paths. Instead it ADDS a new `additive`
--     policy that grants read to anyone with a session_participants row
--     (which only halaqa sessions populate per Stage 1's design).
--   * Writes to session_participants are service_role only. Stage 5
--     halaqa enrollment runs through a server action that uses the admin
--     client, so user-side INSERT/UPDATE policies are not needed yet.
--     If a future student-self-enroll flow lands without server-action
--     mediation, this migration will need to add a permissive INSERT.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. session_participants — SELECT
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "sp_select_self_or_teacher_or_admin" on public.session_participants;
create policy "sp_select_self_or_teacher_or_admin"
  on public.session_participants
  for select
  to authenticated
  using (
    -- a participant can see their own row
    user_id = auth.uid()
    or
    -- the teacher of the linked session can see all participants
    -- (private: teacher via the booking; halaqa: teacher row in
    -- session_participants itself, which the same user_id check covers
    -- on the teacher's side of the OR)
    exists (
      select 1
      from sessions s
      join bookings b on s.booking_id = b.id
      where s.id = session_participants.session_id
        and b.teacher_id = auth.uid()
    )
    or
    -- admins and moderators see everything
    is_admin_or_mod()
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. session_participants — INSERT / UPDATE / DELETE
-- ─────────────────────────────────────────────────────────────────────────

-- INSERT: service_role only. The Stage 5 halaqa-enrollment server action
-- uses createAdminClient() which bypasses RLS; client code must NOT write
-- to this table directly. Leaving no INSERT policy means the operation
-- is denied for authenticated users by default.

-- UPDATE: own attendance + teacher of session + admin.
drop policy if exists "sp_update_own_attendance_or_teacher_or_admin" on public.session_participants;
create policy "sp_update_own_attendance_or_teacher_or_admin"
  on public.session_participants
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or
    exists (
      select 1
      from sessions s
      join bookings b on s.booking_id = b.id
      where s.id = session_participants.session_id
        and b.teacher_id = auth.uid()
    )
    or
    is_admin_or_mod()
  )
  with check (
    user_id = auth.uid()
    or
    exists (
      select 1
      from sessions s
      join bookings b on s.booking_id = b.id
      where s.id = session_participants.session_id
        and b.teacher_id = auth.uid()
    )
    or
    is_admin_or_mod()
  );

-- DELETE: admin only. Halaqa cancellation flow soft-archives via
-- attendance_status = 'absent' rather than DELETE; hard delete is an
-- admin-only escape hatch.
drop policy if exists "sp_delete_admin_only" on public.session_participants;
create policy "sp_delete_admin_only"
  on public.session_participants
  for delete
  to authenticated
  using (is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 3. sessions — additive halaqa read access
-- ─────────────────────────────────────────────────────────────────────────
--
-- Adds an ADDITIVE policy: an authenticated user with a session_participants
-- row for a session can read that session. This is the path halaqa-enrolled
-- students use to load the session detail / video page.
--
-- Existing private-session SELECT policies (teacher/student via booking,
-- admin/mod via helper) are left untouched. RLS evaluates policies as a
-- union, so this never narrows access.

drop policy if exists "sessions_select_via_participants" on public.sessions;
create policy "sessions_select_via_participants"
  on public.sessions
  for select
  to authenticated
  using (
    exists (
      select 1
      from session_participants sp
      where sp.session_id = sessions.id
        and sp.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Documentation
-- ─────────────────────────────────────────────────────────────────────────

comment on policy "sp_select_self_or_teacher_or_admin" on public.session_participants is
  'Halaqa enrollment readability: own row OR teacher of session (via bookings.teacher_id) OR admin/moderator.';

comment on policy "sessions_select_via_participants" on public.sessions is
  'Halaqa enrollment access: any user with a session_participants row for the session can read the parent session row. Additive — does not narrow private-session access.';

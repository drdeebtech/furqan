-- Re-introduce sessions-via-participants read access, recursion-safe
--
-- Hotfix 20260506042910 dropped `sessions_select_via_participants` after
-- it caused infinite RLS recursion (PG 42P17) — sessions' policy queried
-- session_participants, whose own policy queried sessions back. The fix
-- promised a SECURITY DEFINER helper that bypasses RLS internally,
-- breaking the cycle.
--
-- This migration ships that promised v2:
--
--   1. user_is_session_participant(s_id uuid) — SQL function with
--      SECURITY DEFINER + STABLE + locked search_path. Runs as the
--      function owner (postgres), which bypasses the calling user's
--      RLS for the inner SELECT. The cycle ends because session_participants'
--      RLS doesn't fire when the helper queries it.
--
--   2. sessions_select_via_participants_v2 — sessions SELECT policy that
--      delegates to the helper. RLS evaluation on sessions sees a single
--      function call instead of a sub-SELECT against session_participants,
--      so it can't recurse back into sessions.
--
-- Stage 5 enrollment flows can now safely depend on halaqa enrollees
-- being able to read their own session rows from the client. Until
-- session_participants has rows (Stage 5 hasn't shipped yet), this
-- policy never grants access — same effective behavior as today, just
-- with the path open for Stage 5.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. SECURITY DEFINER helper
-- ─────────────────────────────────────────────────────────────────────────

create or replace function user_is_session_participant(s_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from session_participants
    where session_id = s_id
      and user_id = auth.uid()
  );
$$;

-- Lock down the helper: only authenticated users + service_role can call it.
-- Anonymous users have no need (they can't be enrolled in anything) and
-- giving them EXECUTE would let them enumerate session ids.
revoke execute on function user_is_session_participant(uuid) from public;
grant execute on function user_is_session_participant(uuid) to authenticated;

comment on function user_is_session_participant(uuid) is
  'SECURITY DEFINER helper for the sessions_select_via_participants_v2 policy. Returns true iff the calling user has a session_participants row for the given session. Runs as function owner so the inner SELECT bypasses RLS, breaking the recursion that made the v1 policy infinite.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Re-introduce the additive sessions SELECT policy
-- ─────────────────────────────────────────────────────────────────────────
--
-- ADDITIVE — RLS evaluates policies as a union, so this never narrows
-- existing access. Private session SELECT paths (teacher/student via
-- booking, admin via helper) remain untouched. The new path lets a
-- halaqa enrollee read the session row they're enrolled in.

drop policy if exists "sessions_select_via_participants_v2" on public.sessions;
create policy "sessions_select_via_participants_v2"
  on public.sessions
  for select
  to authenticated
  using (user_is_session_participant(id));

comment on policy "sessions_select_via_participants_v2" on public.sessions is
  'Halaqa enrollment access (recursion-safe v2). Calls user_is_session_participant() which is SECURITY DEFINER, so the inner check on session_participants does not re-trigger sessions RLS. Replaces v1 (sessions_select_via_participants) which was dropped on 2026-05-06 due to mutual recursion with session_participants own policy.';

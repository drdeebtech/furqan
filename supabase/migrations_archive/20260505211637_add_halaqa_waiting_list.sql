-- Stage 5 (schema prep) / Track A — Halaqa Waiting List
--
-- Adds the `halaqa_waiting_list` table that backs the "halaqa is full —
-- join the waiting list" UX coming in Stage 5's enrollment server actions.
--
-- ZERO behavior change. Empty table, RLS enabled with no policies (only
-- service_role can touch it during this schema-prep phase). Stage 5's
-- backend code will add policies + the promote-on-cancellation flow.
--
-- This is intentionally split out from the main Stage 5 PR so reviewers
-- can verify the schema in isolation before the booking flow lands. The
-- table is referenced (FK) by sessions + profiles, both of which exist
-- on main — no Stage 1/2/3 dependency.

create table if not exists halaqa_waiting_list (
  id uuid primary key default gen_random_uuid(),
  -- The halaqa session the student is waiting for. Cascades on session
  -- delete because a deleted halaqa shouldn't leave dangling waitlist
  -- rows; the cancellation flow handles graceful empty-out separately.
  session_id uuid not null references sessions(id) on delete cascade,
  -- The student waiting for a spot. Cascades on profile delete.
  student_id uuid not null references profiles(id) on delete cascade,
  -- Position in line. Stage 5's enrollment cancellation will promote
  -- position=1 + decrement everyone above. Not a generated column
  -- because we want explicit control over reordering.
  position integer not null check (position >= 1),
  -- Set when the row was created so the cancellation handler can break
  -- ties deterministically (FIFO).
  created_at timestamptz not null default now(),
  -- Set when this person was promoted off the list. Null while pending.
  -- Stage 5 will read this to surface "you've been promoted" notifications
  -- without re-querying the participants table.
  promoted_at timestamptz,
  -- A student can only wait once per halaqa.
  unique (session_id, student_id)
);

-- Lookup index: who's on the list for this halaqa, in order.
create index if not exists idx_halaqa_waiting_list_session_position
  on halaqa_waiting_list (session_id, position);

-- Lookup index: every halaqa this student is waiting for.
create index if not exists idx_halaqa_waiting_list_student
  on halaqa_waiting_list (student_id);

-- RLS enabled with no policies — Stage 5's backend PR will add:
--   SELECT: own row OR teacher of the session OR admin
--   INSERT/UPDATE/DELETE: service_role only (server-action mediated)
alter table halaqa_waiting_list enable row level security;

comment on table halaqa_waiting_list is
  'Halaqa "join the waiting list" queue. One row per (session, student) waiting on a full halaqa to free up a seat. Stage 5 enrollment cancellation flow promotes position=1 and decrements the rest.';

comment on column halaqa_waiting_list.position is
  'Position in line, starting at 1. Cancellation promotes position=1 and decrements every other row by 1.';

comment on column halaqa_waiting_list.promoted_at is
  'Set when the row was promoted off the list (a seat opened up and this student was offered it). Null while still waiting. Stage 5 will keep promoted rows around briefly so the student-facing notification can render the "you got in" CTA without re-querying participants.';

-- Stage 5 prep — add sessions.scheduled_at
--
-- Halaqa sessions need a scheduled time but won't have a booking_id
-- (sessions.booking_id was made nullable in the previous migration).
-- For private sessions, scheduled time has historically been derived
-- from the linked booking's scheduled_at via JOIN. Halaqa rows have no
-- such anchor, so they need to store the time directly on the session.
--
-- Approach: add `scheduled_at TIMESTAMPTZ NULL` on sessions.
--   - Private rows: leave NULL; legacy code paths continue to read
--     scheduled_at from the linked booking (no behavior change today)
--   - Halaqa rows: set scheduled_at directly when the admin halaqa
--     creation form ships (Stage 5 form PR)
--
-- The column is nullable so the migration is purely additive and
-- doesn't disturb any existing query that joins bookings for the time.
-- Stage 5 enrollment + halaqa list views will use COALESCE between
-- session.scheduled_at and bookings.scheduled_at when displaying time
-- — gives both halaqa (direct) and private (via booking) flows a
-- single read pattern.

alter table sessions
  add column if not exists scheduled_at timestamptz;

-- Index supports halaqa list views ("upcoming halaqas") that filter +
-- order by scheduled_at. Partial index keeps it small — only halaqa rows
-- (where session_mode = 'halaqa') populate the column today.
create index if not exists idx_sessions_scheduled_at
  on sessions (scheduled_at)
  where scheduled_at is not null;

comment on column sessions.scheduled_at is
  'Direct scheduled time, used by halaqa sessions (which have NULL booking_id). Private sessions leave this NULL and continue to derive scheduled time from bookings.scheduled_at via the booking_id FK. Stage 5 form will set this when an admin creates a halaqa.';

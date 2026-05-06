-- Stage 5 prep — make sessions.booking_id nullable
--
-- Pre-stage-5 structural decision per the migration-plan critique:
-- halaqa sessions don't have a single anchor booking (one teacher,
-- many enrolled students). The two viable models were:
--
--   A) Make sessions.booking_id NULLABLE — relaxes the FK constraint,
--      lets halaqa rows exist without a parent booking. Each enrolled
--      student gets a session_participants row instead.
--   B) Keep booking_id NOT NULL and mint synthetic "anchor bookings"
--      for the teacher of each halaqa.
--
-- Picked A. Reasoning:
--   - Cleaner semantic match — booking represents 1:1 commercial
--     transaction; halaqa enrollment is a different concept tracked in
--     session_participants (the table introduced in Stage 1).
--   - Smaller code surface — synthetic anchor bookings would clutter
--     bookings tables, dashboards, and reports with rows that don't
--     represent a real student-teacher commitment.
--   - Future revenue modeling stays clean — when halaqa per-seat
--     pricing lands (Stage 5 halaqa_pricing_tiers), each enrolled
--     student can have their own booking row pointing at the same
--     halaqa session_id, OR no booking at all (gift / package-included).
--     Both flows fit a nullable column; neither fits a forced-anchor.
--
-- ZERO behavior change today:
--   - Every existing session row already has booking_id set; relaxing
--     the constraint doesn't touch any data
--   - No app code currently inserts NULL booking_id (Stage 5 will be
--     the first writer)
--   - The FK reference (ON DELETE SET NULL) is already on the column —
--     SET NULL is the cascade behavior even with NOT NULL today, the
--     CHECK just blocks NULL on insert
--
-- The TypeScript types (src/types/supabase.generated.ts) auto-regenerate
-- via `npm run db:types` and start declaring booking_id as `string | null`.
-- Existing call sites that do `s.booking_id` will get TS errors on read
-- (good — flushes out implicit-non-null assumptions). Those are
-- incrementally addressed in follow-up PRs as Stage 5 begins inserting
-- halaqa sessions.

alter table sessions
  alter column booking_id drop not null;

comment on column sessions.booking_id is
  'Optional anchor booking. Required for legacy 1:1 private sessions (every existing row has it set). NULL for halaqa sessions where enrollment is tracked in session_participants instead. Nullability relaxed in 2026-05-06 per Stage 5 prep.';

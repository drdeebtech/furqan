-- ============================================================================
-- V14.8: Generated column student_packages.sessions_remaining
--
-- Why: control-tower's "low-balance" alert filters on
--   `sessions_total - sessions_used <= 2`
-- which is a cross-column predicate that can't be expressed via PostgREST's
-- JS query builder (`.lte()` treats RHS as a literal, not a column ref).
-- Without this column, the page fetches ALL active student_packages rows and
-- filters in JS — fine at current scale, painful as the platform grows.
--
-- Adding a STORED generated column lets the filter move server-side as
-- `.lte("sessions_remaining", 2)` and supports indexing.
--
-- Schema check (2026-04-25): student_packages has sessions_total +
-- sessions_used as integer NOT NULL, no existing sessions_remaining.
--
-- Reversible: DROP COLUMN sessions_remaining; DROP INDEX idx_student_packages_low_balance;
-- ============================================================================

ALTER TABLE student_packages
  ADD COLUMN IF NOT EXISTS sessions_remaining integer
  GENERATED ALWAYS AS (sessions_total - sessions_used) STORED;

-- Partial index covers the exact alert query (active + low-balance).
-- Tiny because most active packages have plenty of sessions left.
CREATE INDEX IF NOT EXISTS idx_student_packages_low_balance
  ON student_packages(sessions_remaining)
  WHERE status = 'active' AND sessions_remaining <= 2;

INSERT INTO schema_migrations (version, description)
VALUES ('14.8.0', 'V14.8: student_packages.sessions_remaining generated column + partial low-balance index')
ON CONFLICT DO NOTHING;

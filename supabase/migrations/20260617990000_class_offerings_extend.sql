-- T002a: Extend class_offerings with scheduling and entry condition columns.
-- These 5 columns are absent in the baseline but required for spec 020 overflow and course logic.
-- Applies BEFORE T003/T004 (earlier timestamp 20260617990000).

ALTER TABLE class_offerings
  ADD COLUMN IF NOT EXISTS program_level text,
  ADD COLUMN IF NOT EXISTS schedule_json jsonb,
  ADD COLUMN IF NOT EXISTS session_duration_min integer,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS entry_conditions_json jsonb,
  ADD COLUMN IF NOT EXISTS current_enrollment integer NOT NULL DEFAULT 0;

-- Note on program_level: it is NULL for legacy rows. 
-- Sibling matching (open_overflow_halaqa) keys on this column; a NULL level never matches.
-- New offerings created for overflow must require program_level.

-- Add recitation_standard column to student_progress.
--
-- Why: 4 application files query `student_progress.recitation_standard` but
-- the column doesn't exist on the live schema (caught during 2026-05-05
-- Phase 2B audit, F15). Same silent-failure pattern as F14 — PostgREST
-- returned 400, page swallowed via `?? null`, the recitation-standard
-- pill on /teacher/students/[id], the welcome-header pill on /student
-- /dashboard, the pre-session prep panel on /teacher/sessions/[id], and
-- the "matches your tradition" indicator on /student/teachers all stayed
-- invisible.
--
-- The team's intent is clear: track which qira'a (Hafs / Warsh / etc) the
-- student is studying in, captured per progress entry so a transition can
-- be recorded over time. This is real Quran-pedagogy signal — Hafs an
-- Asim vs Warsh an Nafi vs Qalon vs Al-Duri etc. is fundamental to how
-- the recitation is taught.
--
-- Same TEXT-CHECK enum the team already uses for `ijazah_pathways
-- .recitation_standard` and the hand-authored `RecitationStandard` type
-- in src/types/database.ts.

ALTER TABLE student_progress
  ADD COLUMN IF NOT EXISTS recitation_standard TEXT
  CHECK (recitation_standard IN ('hafs', 'warsh', 'qalon', 'al_duri', 'shu_ba'));

-- No backfill needed — column is nullable. Existing rows get NULL,
-- which is what the queries already expect (`?? null` defaults).
-- New progress rows can opt in by setting the standard at write time.

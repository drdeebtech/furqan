-- 20260601175916_recitation_errors_require_surah.sql
-- Spec 010 (hifz-progress-capture), FR-006.
--
-- A recitation error pinned to an āyah but no sūrah is ambiguous (which of 114?).
-- Require surah_num for all REAL errors, while preserving the existing
-- "no errors observed" sentinel rows (which legitimately carry no location).
--
-- No backfill: there are currently zero real error rows (only the sentinel uses
-- this table today), so this constraint is satisfiable as-is.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recitation_errors_surah_required') then
    alter table public.recitation_errors
      add constraint recitation_errors_surah_required
      -- `is not distinct from` (not `=`) so a NULL note evaluates to FALSE, not
      -- UNKNOWN — otherwise a row with both surah_num NULL and note NULL passes
      -- the CHECK (UNKNOWN is treated as satisfied), defeating the rule.
      check (surah_num is not null or note is not distinct from '__no_errors_observed_sentinel__');
  end if;
end $$;

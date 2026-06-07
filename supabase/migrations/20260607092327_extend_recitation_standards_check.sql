-- 20260607092327_extend_recitation_standards_check.sql
-- Description: Extend teacher_profiles.recitation_standards CHECK to match the
-- product's riwayah picklist (12 values in src/lib/constants.ts / the apply
-- form's VALID_RECITATIONS). The live constraint only allowed 5 values
-- (hafs, warsh, qalon, al_duri, shu_ba), so any applicant or admin CV edit
-- selecting al_susi/hisham/ibn_dhakwan/al_bazzi/qunbul/khalaf_hamzah/khallad/
-- al_duri_basri failed with a 23514 check violation.
-- 'al_duri' (legacy) is kept so existing rows remain valid; the app writes
-- the more specific 'al_duri_basri'.
-- Found via PR #421 review (CodeRabbit) + verified against the live constraint.

alter table public.teacher_profiles
  drop constraint if exists teacher_profiles_recitation_standards_check;

alter table public.teacher_profiles
  add constraint teacher_profiles_recitation_standards_check
  check (recitation_standards <@ array[
    'hafs', 'shu_ba', 'warsh', 'qalon',
    'al_duri',        -- legacy value present in existing rows
    'al_duri_basri', 'al_susi', 'hisham', 'ibn_dhakwan',
    'al_bazzi', 'qunbul', 'khalaf_hamzah', 'khallad'
  ]::text[]);

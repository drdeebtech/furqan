-- 20260505191211_update_help_center_homework_label_to_followup.sql
-- Update help_categories label_ar / label_en for the 'homework' category
-- so the live row matches the rest of the platform's user-facing
-- "Follow-up" / "متابعة" wording (per the 2026-05-05 rename pass that
-- swapped homework→follow-up across UI strings, comments, docs, and
-- Obsidian).
--
-- Slug ('homework') stays as the identifier so foreign references in
-- live data don't break — only the bilingual labels change. The earlier
-- migration 20260429171328_add_help_center_tables.sql seeded this row;
-- that file is historical/immutable, so this is the data-side fix.

-- The primary key column on help_categories is `slug` (per migration
-- 20260429171328_add_help_center_tables.sql), not `key`. First attempt
-- of this migration assumed `key` and failed with column-not-found.
update public.help_categories
set
  label_ar = 'المتابعات',
  label_en = 'Follow-ups'
where slug = 'homework'
  and (label_ar = 'الواجبات' or label_en = 'Homework');

-- Adds an optional English bio alongside the existing (Arabic) bio on teacher_profiles.
-- Existing `bio` column keeps its Arabic semantics — no backfill; teachers fill bio_en over time.
-- Student/admin surfaces read lang-appropriate column with fallback when empty.

alter table teacher_profiles
  add column if not exists bio_en text;

-- Record the migration
insert into schema_migrations (version, description)
values ('v14_006', 'teacher_profiles.bio_en (English bio column)')
on conflict (version) do nothing;

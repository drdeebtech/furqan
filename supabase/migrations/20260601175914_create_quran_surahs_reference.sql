-- 20260601175914_create_quran_surahs_reference.sql
-- Spec 010 (hifz-progress-capture), FR-003 / Key Entity quran_surahs.
--
-- Canonical āyah-count reference: the DB source of truth for the FR-002
-- range-validation trigger. Counts are Ḥafṣ ʿan ʿĀṣim, Madanī muṣḥaf numbering
-- (total 6236 āyāt) — fixed canonical data. Sūrah NAMES are intentionally NOT
-- duplicated here; they live in their existing single source src/lib/quran/
-- surahs.ts. This table is the COUNT authority only (no name drift).
--
-- The application-layer mirror is src/lib/quran/ayah-counts.ts; a unit test
-- asserts the two agree.

create table if not exists public.quran_surahs (
  surah_num  smallint primary key check (surah_num between 1 and 114),
  ayah_count smallint not null check (ayah_count > 0),
  juz_start  smallint  -- nullable; reserved for a future Juzʾ-tracking phase (not used in v1)
);

comment on table public.quran_surahs is
  'Canonical per-surah ayah counts (Hafs/Madani mushaf, total 6236). Count authority for the student_progress range guard. Names live in src/lib/quran/surahs.ts.';

insert into public.quran_surahs (surah_num, ayah_count) values
  (1,7),(2,286),(3,200),(4,176),(5,120),(6,165),(7,206),(8,75),(9,129),(10,109),
  (11,123),(12,111),(13,43),(14,52),(15,99),(16,128),(17,111),(18,110),(19,98),(20,135),
  (21,112),(22,78),(23,118),(24,64),(25,77),(26,227),(27,93),(28,88),(29,69),(30,60),
  (31,34),(32,30),(33,73),(34,54),(35,45),(36,83),(37,182),(38,88),(39,75),(40,85),
  (41,54),(42,53),(43,89),(44,59),(45,37),(46,35),(47,38),(48,29),(49,18),(50,45),
  (51,60),(52,49),(53,62),(54,55),(55,78),(56,96),(57,29),(58,22),(59,24),(60,13),
  (61,14),(62,11),(63,11),(64,18),(65,12),(66,12),(67,30),(68,52),(69,52),(70,44),
  (71,28),(72,28),(73,20),(74,56),(75,40),(76,31),(77,50),(78,40),(79,46),(80,42),
  (81,29),(82,19),(83,36),(84,25),(85,22),(86,17),(87,19),(88,26),(89,30),(90,20),
  (91,15),(92,21),(93,11),(94,8),(95,8),(96,19),(97,5),(98,8),(99,8),(100,11),
  (101,11),(102,8),(103,3),(104,9),(105,5),(106,4),(107,7),(108,3),(109,6),(110,3),
  (111,5),(112,4),(113,5),(114,6)
on conflict (surah_num) do update set ayah_count = excluded.ayah_count;

-- Integrity self-check (lens-2 safety): a mistyped count would change the total
-- away from the canonical 6236 and abort the migration loudly.
do $$
declare v_total int; v_rows int;
begin
  select coalesce(sum(ayah_count),0), count(*) into v_total, v_rows from public.quran_surahs;
  if v_rows <> 114 or v_total <> 6236 then
    raise exception 'quran_surahs integrity check failed: % rows totalling % (expected 114 / 6236)', v_rows, v_total;
  end if;
end $$;

-- RLS: reference data — readable by any authenticated user, writable only by
-- service-role / migrations (no app write path).
alter table public.quran_surahs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quran_surahs' and policyname='quran_surahs_read_all') then
    create policy quran_surahs_read_all on public.quran_surahs for select to authenticated using (true);
  end if;
end $$;

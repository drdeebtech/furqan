-- 20260601175915_student_progress_ayah_range_guard.sql
-- Spec 010 (hifz-progress-capture), FR-002 (NON-NEGOTIABLE — Islamic accuracy).
--
-- Make Islamically-impossible āyah ranges UNREPRESENTABLE for every writer of
-- student_progress (app, RPC, manual SQL, future import) by validating against
-- the canonical quran_surahs reference in a BEFORE INSERT/UPDATE trigger. Plus
-- cheap in-table CHECKs for the >=1 invariants. The existing valid_progress_range
-- CHECK already enforces surah/ayah ordering; this adds the per-surah upper bound.

-- Cheap invariants (defense in depth, layer 3).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_progress_ayah_from_positive') then
    alter table public.student_progress
      add constraint student_progress_ayah_from_positive check (ayah_from is null or ayah_from >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'student_progress_ayah_to_positive') then
    alter table public.student_progress
      add constraint student_progress_ayah_to_positive check (ayah_to is null or ayah_to >= 1);
  end if;
end $$;

-- Cross-table hard guard (layer 2): a CHECK can't reference another table, so a
-- BEFORE trigger reads quran_surahs and rejects out-of-bounds āyahs.
create or replace function public.validate_student_progress_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_from_count smallint;
  v_to_count smallint;
begin
  if new.surah_from is not null then
    select ayah_count into v_from_count from quran_surahs where surah_num = new.surah_from;
    if v_from_count is null then
      raise exception 'invalid surah_from %', new.surah_from using errcode = '23514';
    end if;
    if new.ayah_from is not null and new.ayah_from > v_from_count then
      raise exception 'ayah_from % exceeds surah % ayah count %', new.ayah_from, new.surah_from, v_from_count
        using errcode = '23514';
    end if;
  end if;

  if new.surah_to is not null then
    select ayah_count into v_to_count from quran_surahs where surah_num = new.surah_to;
    if v_to_count is null then
      raise exception 'invalid surah_to %', new.surah_to using errcode = '23514';
    end if;
    if new.ayah_to is not null and new.ayah_to > v_to_count then
      raise exception 'ayah_to % exceeds surah % ayah count %', new.ayah_to, new.surah_to, v_to_count
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_validate_student_progress_range on public.student_progress;
create trigger t_validate_student_progress_range
  before insert or update of surah_from, ayah_from, surah_to, ayah_to
  on public.student_progress
  for each row
  execute function validate_student_progress_range();

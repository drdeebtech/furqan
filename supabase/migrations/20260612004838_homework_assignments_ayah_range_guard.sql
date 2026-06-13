-- 20260612004838_homework_assignments_ayah_range_guard.sql
--
-- Make Islamically-impossible surah/ayah ranges unrepresentable for
-- homework_assignments, mirroring student_progress_ayah_range_guard.
--
-- homework_assignments uses a single-surah model (surah_number, ayah_start,
-- ayah_end) rather than the cross-surah (surah_from/to) model of
-- student_progress, so the guard is simpler: validate against quran_surahs
-- and enforce ayah_start <= ayah_end within the same surah.
--
-- Pre-flight audit (2026-06-12, against production):
--   bad_lt1      = 0  (no rows with ayah_start < 1 or ayah_end < 1)
--   reversed     = 0  (no rows with ayah_start > ayah_end)
--   overflow     = 0  (no rows where ayah exceeds quran_surahs.ayah_count)
--   invalid_surah = 0 (no rows with surah_number not in 1..114)
-- Zero violations → no repair phase needed; plain ADD CONSTRAINT is safe.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'homework_ayah_start_positive' and conrelid = 'public.homework_assignments'::regclass) then
    alter table public.homework_assignments
      add constraint homework_ayah_start_positive
        check (ayah_start is null or ayah_start >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'homework_ayah_end_positive' and conrelid = 'public.homework_assignments'::regclass) then
    alter table public.homework_assignments
      add constraint homework_ayah_end_positive
        check (ayah_end is null or ayah_end >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'homework_ayah_order' and conrelid = 'public.homework_assignments'::regclass) then
    alter table public.homework_assignments
      add constraint homework_ayah_order
        check (
          surah_number is null
          or ayah_start is null
          or ayah_end is null
          or ayah_start <= ayah_end
        );
  end if;
end $$;

create or replace function public.validate_homework_ayah_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count smallint;
begin
  if new.surah_number is not null then
    select ayah_count into v_count from quran_surahs where surah_num = new.surah_number;
    if v_count is null then
      raise exception 'invalid surah_number % for homework_assignments', new.surah_number
        using errcode = '23514';
    end if;
    if new.ayah_start is not null and new.ayah_start > v_count then
      raise exception 'ayah_start % exceeds surah % ayah count %',
        new.ayah_start, new.surah_number, v_count
        using errcode = '23514';
    end if;
    if new.ayah_end is not null and new.ayah_end > v_count then
      raise exception 'ayah_end % exceeds surah % ayah count %',
        new.ayah_end, new.surah_number, v_count
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists t_validate_homework_ayah_range on public.homework_assignments;
create trigger t_validate_homework_ayah_range
  before insert or update of surah_number, ayah_start, ayah_end
  on public.homework_assignments
  for each row
  execute function validate_homework_ayah_range();

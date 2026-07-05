-- F1 (Quran integrity §4 "progress merged, never overwritten"): the upsert key
-- on record_student_progress is (student_id, booking_id) — one row per session —
-- and the prior ON CONFLICT DO UPDATE copied every column from `excluded`
-- UNCONDITIONALLY. Because capture.ts allows a `correction`/`muraja` write to
-- carry a NULL range, a second write on the same booking wiped the memorized
-- surah:ayah range to NULL. That is exactly the "never silently lose/reset
-- memorization" invariant being violated inside the function whose own comment
-- calls it "the hard guard for every writer."
--
-- Fix: COALESCE the value columns in DO UPDATE so a NULL in a later write can
-- never erase a previously-recorded value. A later write may still SET a value
-- (new non-null overwrites old) — it just cannot NULL one out. `progress_type`,
-- `level`, and `teacher_notes` keep last-write-wins on purpose: a deliberate
-- re-classification of the session (via the progress form) is a teacher choice,
-- and `coalesce(p_level,'beginner')` / `coalesce(p_progress_type,'new')` mean
-- those are never null anyway. The silent `new`→`muraja` downgrade from the
-- "no errors observed" button is closed separately in the app layer (F2).
--
-- Body reproduced verbatim from 20260613150000_cap_record_student_progress_errors.sql;
-- the ONLY change is the four range columns + pages_reviewed + quality_rating in
-- the ON CONFLICT clause now COALESCE against the existing row. Expand/contract
-- safe: pure CREATE OR REPLACE of a function body, no schema/type change, and
-- the new behavior is a strict superset of the old for the normal single-write
-- path (a first insert is unaffected; only a second same-booking write differs).
create or replace function public.record_student_progress(p_booking_id uuid, p_progress_type text, p_surah_from integer, p_ayah_from integer, p_surah_to integer, p_ayah_to integer, p_pages_reviewed integer, p_quality_rating integer, p_level text, p_teacher_notes text, p_errors jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_student uuid;
  v_teacher uuid;
  v_progress_id uuid;
begin
  -- Derive parties from the booking (caller already authorized at the adapter).
  select student_id, teacher_id into v_student, v_teacher
  from bookings where id = p_booking_id;
  if v_student is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  insert into student_progress (
    student_id, teacher_id, booking_id, progress_type,
    surah_from, ayah_from, surah_to, ayah_to,
    pages_reviewed, quality_rating, level, teacher_notes
  )
  values (
    v_student, v_teacher, p_booking_id, coalesce(p_progress_type, 'new'),
    p_surah_from, p_ayah_from, p_surah_to, p_ayah_to,
    p_pages_reviewed, p_quality_rating, coalesce(p_level, 'beginner')::student_level, p_teacher_notes
  )
  on conflict (student_id, booking_id) do update set
    progress_type  = excluded.progress_type,
    -- COALESCE: a NULL in a later write must never erase a memorized range or
    -- a recorded metric. A non-null later value still overwrites (real update).
    surah_from     = coalesce(excluded.surah_from, student_progress.surah_from),
    ayah_from      = coalesce(excluded.ayah_from, student_progress.ayah_from),
    surah_to       = coalesce(excluded.surah_to, student_progress.surah_to),
    ayah_to        = coalesce(excluded.ayah_to, student_progress.ayah_to),
    pages_reviewed = coalesce(excluded.pages_reviewed, student_progress.pages_reviewed),
    quality_rating = coalesce(excluded.quality_rating, student_progress.quality_rating),
    level          = excluded.level,
    teacher_notes  = excluded.teacher_notes
  returning id into v_progress_id;
  -- t_validate_student_progress_range fires here; an impossible range raises 23514.

  if p_errors is not null and jsonb_typeof(p_errors) = 'array' and jsonb_array_length(p_errors) > 500 then
    raise exception 'too many recitation errors (max 500)' using errcode = '22023';
  end if;

  -- Replace this booking's errors. When the teacher supplies real errors, clear
  -- ALL prior rows for this progress — including any "no errors observed"
  -- sentinel, which would otherwise coexist with real errors and leave a
  -- contradictory state. When no errors are supplied (p_errors null/empty),
  -- leave existing rows untouched (preserves a prior sentinel set via
  -- markNoErrorsObserved).
  if p_errors is not null and jsonb_typeof(p_errors) = 'array' and jsonb_array_length(p_errors) > 0 then
    delete from recitation_errors where progress_id = v_progress_id;
    insert into recitation_errors (progress_id, surah_num, ayah_num, error_type, note)
    select
      v_progress_id,
      (e->>'surah_num')::smallint,
      (e->>'ayah_num')::integer,
      e->>'error_type',
      nullif(e->>'note', '')
    from jsonb_array_elements(p_errors) e;
  end if;

  return v_progress_id;
end;
$function$;

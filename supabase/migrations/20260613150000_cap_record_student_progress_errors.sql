-- Cap p_errors array length at 500 to prevent amplified service-role inserts
-- via record_student_progress. The function body is reproduced verbatim from
-- the live definition; the ONLY change is the added guard near the top of the
-- body (before the existing errors handling).
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
    surah_from     = excluded.surah_from,
    ayah_from      = excluded.ayah_from,
    surah_to       = excluded.surah_to,
    ayah_to        = excluded.ayah_to,
    pages_reviewed = excluded.pages_reviewed,
    quality_rating = excluded.quality_rating,
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

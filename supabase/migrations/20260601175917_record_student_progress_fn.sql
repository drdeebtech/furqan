-- 20260601175917_record_student_progress_fn.sql
-- Spec 010 (hifz-progress-capture), FR-005 (atomic) / FR-001.
--
-- Atomic capture: upsert one student_progress row (per the existing unique
-- (student_id, booking_id)) AND replace its recitation_errors, in ONE
-- transaction. The validate_student_progress_range trigger fires inside this
-- txn, so an impossible range aborts the entire capture (no partial write).
--
-- security definer + fixed search_path (same hardening as confirm_booking_with_
-- session / deduct_package_session). The caller is authorized at the route
-- adapter (Principle IV): requireRole("teacher") + owns-booking check.

create or replace function public.record_student_progress(
  p_booking_id     uuid,
  p_progress_type  text,
  p_surah_from     integer,
  p_ayah_from      integer,
  p_surah_to       integer,
  p_ayah_to        integer,
  p_pages_reviewed integer,
  p_quality_rating integer,
  p_level          text,
  p_teacher_notes  text,
  p_errors         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- Replace this booking's real errors (idempotent re-capture); never touch the
  -- "no errors observed" sentinel row.
  delete from recitation_errors
  where progress_id = v_progress_id
    and note is distinct from '__no_errors_observed_sentinel__';

  if p_errors is not null and jsonb_typeof(p_errors) = 'array' then
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
$$;

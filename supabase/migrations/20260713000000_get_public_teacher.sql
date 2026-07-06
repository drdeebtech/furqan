-- 20260713000000_get_public_teacher.sql
-- Spec 037: single-teacher public projection. Mirrors search_public_teachers'
-- column set + visibility predicate exactly. Expand-only (new function).
CREATE OR REPLACE FUNCTION public.get_public_teacher(p_id uuid)
RETURNS TABLE (
  id                   uuid,
  full_name            text,
  full_name_ar         text,
  avatar_url           text,
  bio                  text,
  bio_en               text,
  languages            text[],
  specialties          text[],
  recitation_standards text[],
  hourly_rate          numeric,
  rating_avg           numeric,
  rating_count         int,
  total_sessions       int,
  gender               text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    tp.teacher_id,
    p.full_name,
    p.full_name_ar,
    p.avatar_url,
    tp.bio,
    tp.bio_en,
    tp.languages,
    tp.specialties,
    tp.recitation_standards,
    tp.hourly_rate,
    tp.rating_avg,
    COALESCE(rv.cnt, 0)::int,
    tp.total_sessions,
    tp.gender::text
  FROM teacher_profiles tp
  JOIN profiles p ON p.id = tp.teacher_id
  LEFT JOIN (
    SELECT teacher_id, COUNT(*)::int AS cnt FROM reviews GROUP BY teacher_id
  ) rv ON rv.teacher_id = tp.teacher_id
  WHERE
    tp.is_archived = false
    AND tp.is_accepting = true
    AND tp.cv_status = 'approved'
    AND p.role = 'teacher'
    AND p.is_test_account = false
    AND p.avatar_url IS NOT NULL
    AND tp.teacher_id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_teacher(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_teacher(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_teacher(uuid) TO service_role;

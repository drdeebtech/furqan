-- 20260815000000_teacher_rating_count_materialized.sql
-- Eng-review audit of specs 036/037 (2026-07-19): every public teacher search and
-- every public profile load re-aggregated the ENTIRE reviews table
-- (LEFT JOIN (SELECT teacher_id, COUNT(*) FROM reviews GROUP BY teacher_id)) —
-- a per-query cost that grows with unrelated review volume. rating_avg is
-- already trigger-materialized on teacher_profiles; rating_count now rides the
-- same trigger, and both public RPCs read the column instead of re-counting.
--
-- POLICY (owner decision, eng review 2026-07-19): rating_count and rating_avg
-- deliberately count ALL reviews INCLUDING is_public=false. Hiding a review's
-- text (privacy/moderation) must not erase its score — otherwise hiding bad
-- reviews becomes rating inflation. RLS still hides the text of private rows;
-- only the aggregate signal counts them.
--
-- Expand-only: adds one column with a default; replaces the trigger function
-- and two RPC bodies in place (signatures and return shapes unchanged, so a
-- concurrently-running previous build keeps working).

ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS rating_count int NOT NULL DEFAULT 0;

-- Trigger fn: same attributes as the baseline definition; now maintains both
-- aggregates in one UPDATE.
CREATE OR REPLACE FUNCTION public.update_teacher_rating() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE t_id uuid;
BEGIN
  t_id := COALESCE(NEW.teacher_id, OLD.teacher_id);
  UPDATE teacher_profiles
  SET rating_avg = COALESCE(
        (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE teacher_id = t_id), 0),
      rating_count = COALESCE(
        (SELECT COUNT(*)::int FROM reviews WHERE teacher_id = t_id), 0)
  WHERE teacher_id = t_id;
  RETURN NULL;
END;
$$;

-- One-time backfill so existing teachers match the trigger-maintained value.
UPDATE public.teacher_profiles tp
SET rating_count = COALESCE(rv.cnt, 0)
FROM (SELECT teacher_id, COUNT(*)::int AS cnt FROM public.reviews GROUP BY teacher_id) rv
WHERE rv.teacher_id = tp.teacher_id;

-- search_public_teachers: identical to 20260709 except the reviews subquery is
-- gone — rating_count comes straight off teacher_profiles.
CREATE OR REPLACE FUNCTION public.search_public_teachers(
  p_query         text    DEFAULT NULL,
  p_language      text    DEFAULT NULL,
  p_gender        text    DEFAULT NULL,
  p_specialty     text    DEFAULT NULL,
  p_price_min     numeric DEFAULT NULL,
  p_price_max     numeric DEFAULT NULL,
  p_page          int     DEFAULT 1,
  p_limit         int     DEFAULT 12,
  p_rating_weight numeric DEFAULT 0
)
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
  gender               text,
  total_count          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    tp.rating_count,
    tp.total_sessions,
    tp.gender::text,
    COUNT(*) OVER ()::bigint
  FROM teacher_profiles tp
  JOIN profiles p ON p.id = tp.teacher_id
  WHERE
    tp.is_archived = false
    AND tp.is_accepting = true
    AND tp.cv_status = 'approved'
    AND p.role = 'teacher'
    AND p.is_test_account = false
    AND p.avatar_url IS NOT NULL
    AND (p_language  IS NULL OR tp.languages  @> ARRAY[p_language])
    AND (p_gender    IS NULL OR tp.gender      = p_gender::gender_type)
    AND (p_specialty IS NULL OR tp.specialties @> ARRAY[p_specialty])
    AND (p_price_min IS NULL OR tp.hourly_rate >= p_price_min)
    AND (p_price_max IS NULL OR tp.hourly_rate <= p_price_max)
    AND (
      p_query IS NULL
      OR tp.search_vector @@ websearch_to_tsquery('simple', unaccent(p_query))
      -- immutable_unaccent (not unaccent) so the expression matches
      -- profiles_full_name_search_trgm_idx and the planner can use it.
      OR lower(immutable_unaccent(coalesce(p.full_name, '') || ' ' || coalesce(p.full_name_ar, '')))
           ILIKE '%' || lower(unaccent(p_query)) || '%'
    )
  ORDER BY
    CASE WHEN tp.rating_count >= 3 THEN 1 ELSE 0 END DESC,
    CASE WHEN tp.rating_count >= 3 THEN tp.rating_avg ELSE NULL END DESC NULLS LAST,
    CASE WHEN p_query IS NOT NULL
      THEN ts_rank(tp.search_vector, websearch_to_tsquery('simple', unaccent(p_query)))
      ELSE 0
    END DESC,
    tp.total_sessions DESC
  LIMIT  p_limit
  OFFSET (p_page - 1) * p_limit;
$$;

-- get_public_teacher: same swap (spec 037's single-teacher projection).
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
    tp.rating_count,
    tp.total_sessions,
    tp.gender::text
  FROM teacher_profiles tp
  JOIN profiles p ON p.id = tp.teacher_id
  WHERE
    tp.is_archived = false
    AND tp.is_accepting = true
    AND tp.cv_status = 'approved'
    AND p.role = 'teacher'
    AND p.is_test_account = false
    AND p.avatar_url IS NOT NULL
    AND tp.teacher_id = p_id;
$$;

-- Re-assert the execute lockdown after CREATE OR REPLACE (defense in depth —
-- REPLACE preserves ACLs, but stating them keeps this file self-contained).
REVOKE EXECUTE ON FUNCTION public.search_public_teachers FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_public_teachers FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.search_public_teachers TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_public_teacher(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_teacher(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_teacher(uuid) TO service_role;

-- 20260701181630_teacher_search_vector.sql
-- Spec 036: Full-text search infrastructure on teacher_profiles.
-- Expand-only (additive): no DROP, no RENAME, no NOT NULL on existing columns.

-- Required for diacritics-insensitive search (strips Arabic harakat + accent marks)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE, not IMMUTABLE, so it cannot appear directly in a
-- generated column expression or a functional index. This wrapper marks it
-- IMMUTABLE so Postgres accepts it in both contexts.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
  RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
  $$ SELECT public.unaccent($1); $$;

-- Stored generated tsvector column: materialised at write time, zero cost on read.
-- 'simple' config: tokenises without language-specific stemming — correct for Arabic+English.
-- immutable_unaccent() strips harakat from stored content so حِفْظ and حفظ index identically.
ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(immutable_unaccent(bio), '') || ' ' ||
      coalesce(immutable_unaccent(bio_en), '')
    )
  ) STORED;

-- GIN index on the generated column for fast @@ queries.
-- NOTE: CONCURRENTLY omitted — migrations run inside a transaction.
CREATE INDEX IF NOT EXISTS teacher_profiles_search_vector_gin
  ON public.teacher_profiles USING gin(search_vector);

-- Functional index for name ILIKE search across both Arabic and English name columns.
CREATE INDEX IF NOT EXISTS profiles_full_name_search_idx
  ON public.profiles (lower(immutable_unaccent(coalesce(full_name, '') || ' ' || coalesce(full_name_ar, ''))));

-- search_public_teachers: single entry-point for all teacher search + filter queries.
-- SECURITY DEFINER: runs with definer rights; anon/authenticated REVOKED below.
-- Only the API route (createAdminClient = service_role) may call this function.
-- p_rating_weight is reserved for spec 037 reviews; accepted but unused until then.
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
    COALESCE(rv.cnt, 0)::int,
    tp.total_sessions,
    tp.gender::text,
    COUNT(*) OVER ()::bigint
  FROM teacher_profiles tp
  JOIN profiles p ON p.id = tp.teacher_id
  LEFT JOIN (
    SELECT teacher_id, COUNT(*)::int AS cnt
    FROM reviews GROUP BY teacher_id
  ) rv ON rv.teacher_id = tp.teacher_id
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
      OR lower(unaccent(coalesce(p.full_name, '') || ' ' || coalesce(p.full_name_ar, '')))
           ILIKE '%' || lower(unaccent(p_query)) || '%'
    )
  ORDER BY
    CASE WHEN COALESCE(rv.cnt, 0) >= 3 THEN 1 ELSE 0 END DESC,
    CASE WHEN COALESCE(rv.cnt, 0) >= 3 THEN tp.rating_avg ELSE NULL END DESC NULLS LAST,
    CASE WHEN p_query IS NOT NULL
      THEN ts_rank(tp.search_vector, websearch_to_tsquery('simple', unaccent(p_query)))
      ELSE 0
    END DESC,
    tp.total_sessions DESC
  LIMIT  p_limit
  OFFSET (p_page - 1) * p_limit;
$$;

-- Block direct REST/PostgREST calls from browser clients.
REVOKE EXECUTE ON FUNCTION public.search_public_teachers FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.search_public_teachers TO service_role;

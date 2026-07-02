# Data Model: Teacher Searchable Marketplace (Spec 036)

## Existing tables (read-only for this spec)

### `teacher_profiles` (existing)
Key columns used by search:
| Column | Type | Role in search |
|--------|------|----------------|
| `teacher_id` | uuid PK | joins to `profiles.id` |
| `bio` | text | Arabic bio — included in tsvector |
| `bio_en` | text | English bio — included in tsvector |
| `languages` | text[] | filter: `languages @> ARRAY[lang]` |
| `specialties` | text[] | filter: `specialties @> ARRAY[spec]` |
| `hourly_rate` | numeric | filter: price range |
| `gender` | text | filter: gender |
| `total_sessions` | int | ranking signal |
| `rating_avg` | numeric | ranking signal (when ≥3 reviews) |
| `is_archived` | bool | gate: must be false |
| `is_accepting` | bool | gate: must be true |
| `cv_status` | text | gate: must be 'approved' |

### `profiles` (existing, joined)
| Column | Type | Role in search |
|--------|------|----------------|
| `id` | uuid PK | joins to `teacher_profiles.teacher_id` |
| `full_name` | text | name search (ILIKE) |
| `full_name_ar` | text | Arabic name search (ILIKE) |
| `avatar_url` | text | returned in result card |
| `role` | text | gate: must be 'teacher' |
| `is_test_account` | bool | gate: must be false |

### `teacher_specialties` (existing, for filter options)
Provides the canonical list of specialty keys + bilingual labels for the filter dropdown.

## New schema additions (expand-only, additive)

### Column: `teacher_profiles.search_vector` (generated, stored)
```sql
ALTER TABLE public.teacher_profiles
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(unaccent(bio), '') || ' ' ||
      coalesce(unaccent(bio_en), '')
    )
  ) STORED;
```

**Why stored**: the generated column is materialised at write time, so reads pay zero computation cost. Updates to `bio`/`bio_en` automatically update `search_vector`.

**Why `simple` config**: tokenises without language-specific stemming; works correctly for both Arabic and English; no custom dictionary required.

**Why `unaccent` in the column**: strips Arabic diacritics from stored content so the index terms are diacritics-free. Incoming queries are also passed through `unaccent` in the RPC — so `حِفْظ` and `حفظ` match each other.

### Index: GIN on `search_vector`
```sql
CREATE INDEX CONCURRENTLY teacher_profiles_search_vector_gin
  ON public.teacher_profiles USING gin(search_vector);
```
`CONCURRENTLY` avoids locking; migration applies in CI via the existing `supabase-migrate.yml` workflow.

### Index: functional unaccent index on `profiles.full_name` (name search)
```sql
CREATE INDEX CONCURRENTLY profiles_full_name_search_idx
  ON public.profiles (lower(unaccent(coalesce(full_name, '') || ' ' || coalesce(full_name_ar, ''))));
```
Enables fast ILIKE on the teacher name field across both name columns.

### Function: `search_public_teachers`
```sql
CREATE OR REPLACE FUNCTION public.search_public_teachers(
  p_query      text    DEFAULT NULL,
  p_language   text    DEFAULT NULL,
  p_gender     text    DEFAULT NULL,
  p_specialty  text    DEFAULT NULL,
  p_price_min  numeric DEFAULT NULL,
  p_price_max  numeric DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_limit      int     DEFAULT 12,
  p_rating_weight numeric DEFAULT 0  -- reserved for spec 037 reviews
)
RETURNS TABLE (
  id            uuid,
  full_name     text,
  full_name_ar  text,
  avatar_url    text,
  bio           text,
  bio_en        text,
  languages     text[],
  specialties   text[],
  hourly_rate   numeric,
  rating_avg    numeric,
  rating_count  int,
  total_sessions int,
  gender        text,
  total_count   bigint   -- for pagination
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
    tp.hourly_rate,
    tp.rating_avg,
    COALESCE(rv.cnt, 0)::int,
    tp.total_sessions,
    tp.gender,
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
    AND (p_gender    IS NULL OR tp.gender      = p_gender)
    AND (p_specialty IS NULL OR tp.specialties @> ARRAY[p_specialty])
    AND (p_price_min IS NULL OR tp.hourly_rate >= p_price_min)
    AND (p_price_max IS NULL OR tp.hourly_rate <= p_price_max)
    AND (
      p_query IS NULL
      OR tp.search_vector @@ websearch_to_tsquery('simple', unaccent(p_query))
      OR lower(unaccent(coalesce(p.full_name,'') || ' ' || coalesce(p.full_name_ar,'')))
           ILIKE '%' || lower(unaccent(p_query)) || '%'
    )
  ORDER BY
    -- Teachers with ≥3 reviews rank by review score (same gate as the card display)
    CASE WHEN COALESCE(rv.cnt, 0) >= 3 THEN 1 ELSE 0 END DESC,
    CASE WHEN COALESCE(rv.cnt, 0) >= 3 THEN tp.rating_avg ELSE NULL END DESC NULLS LAST,
    -- Keyword relevance when a query is present
    CASE WHEN p_query IS NOT NULL
      THEN ts_rank(tp.search_vector, websearch_to_tsquery('simple', unaccent(p_query)))
      ELSE 0
    END DESC,
    -- Default: session count descending
    tp.total_sessions DESC
  LIMIT  p_limit
  OFFSET (p_page - 1) * p_limit;
$$;

-- Grant execute only to service_role (the API route uses createAdminClient).
-- anon/authenticated callers must go through the API route where zod validates input.
REVOKE EXECUTE ON FUNCTION public.search_public_teachers FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.search_public_teachers TO service_role;
```

**Security note**: `SECURITY DEFINER` with `REVOKE EXECUTE FROM anon, authenticated` means the function can only be called by service_role (the server-side `createAdminClient()`). Direct REST calls from anon PostgREST are blocked. This prevents filter bypass via raw SQL injection through PostgREST RPC endpoint.

## TeacherCard (returned by the API, consumed by UI)

```typescript
// src/lib/supabase/teacher-search.ts
export interface TeacherCard {
  id: string;
  name: string;          // full_name
  nameAr: string | null; // full_name_ar
  avatarUrl: string;     // guaranteed non-null (gate in SQL)
  bio: string | null;
  bioEn: string | null;
  languages: string[];
  specialties: string[];
  hourlyRate: number;
  ratingAvg: number;
  ratingCount: number;
  totalSessions: number;
  gender: string | null;
}

export interface TeacherSearchResult {
  teachers: TeacherCard[];
  total: number;
  page: number;
  limit: number;
}
```

## SearchParams (input)

```typescript
// Parsed from URL search params in the API route (zod schema)
export const TeacherSearchParamsSchema = z.object({
  q:         z.string().max(200).optional(),
  language:  z.string().max(50).optional(),
  gender:    z.enum(['male', 'female']).optional(),
  specialty: z.string().max(100).optional(),
  price_min: z.coerce.number().nonnegative().optional(),
  price_max: z.coerce.number().nonnegative().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(12),
});
export type TeacherSearchParams = z.infer<typeof TeacherSearchParamsSchema>;
```

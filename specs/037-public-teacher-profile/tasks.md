# Spec 037 — Tasks (verified against local DB 2026-07-05)

Environment is bootstrapped and gate fixtures seeded (see T0). Reference RPC
`search_public_teachers` read from `supabase/migrations/20260709000000_teacher_search_vector.sql`
— its predicate + projection are the source of truth copied below.

## T0 — Verify gate (DONE — my lane) ✅
- Local Supabase bootstrapped (`dev-local-db-bootstrap.sh`), 114 tables, reference RPC present.
- Seeded (`scratchpad/seed_gate_teachers.sql`):
  - PUBLIC `00000000-0000-4000-a000-000000000037` — passes every predicate; canary `phone=+15550000037`. In search ✅.
  - HIDDEN `00000000-0000-4000-a000-0000000000ff` — `cv_status='pending_review'` (fails exactly one predicate). Absent from search ✅.

---

## Feature 1

### T1 — Migration `supabase/migrations/20260713000000_get_public_teacher.sql` (expand-only)
Sorts AFTER the reference RPC (`20260709000000`). SECURITY DEFINER, single-row projection.
Predicate = `search_public_teachers` lines 118–123 **verbatim** + `AND tp.teacher_id = p_id`.
Projection = the 14 contract columns (search RPC's 15 minus the `total_count` pagination artifact).

```sql
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
```

### T2 — `src/lib/supabase/teacher-search.ts` → add `getPublicTeacher(id: string): Promise<TeacherCard | null>`
Mirror `searchTeachers` exactly: `createAdminClient` (service_role) + `callRpc('get_public_teacher', { p_id: id })`.
Map the single row → `TeacherCard`; return `null` when no row.

### T3 — `src/types/database.ts` HAND-EDIT (never blind-regen — it's a corrected layer)
Add a `get_public_teacher` block beside `search_public_teachers` (line ~6515), mirroring its shape:
`Args: { p_id: string }`, `Returns: {…14 columns, NO total_count…}[]`.

### T4 — Route `src/app/(public)/teachers/[teacherId]/page.tsx` (Server Component)
- `notFound()` (404) when `getPublicTeacher` returns null.
- Render: avatar, bilingual name, FULL bio (bio/bio_en by lang), languages, specialties,
  recitation standards, ratings gated at `rating_count >= 3` (stars only), credential badges,
  hourly rate (respect `hidePrices`). RTL/LTR both first-class. WCAG-AA.
- Booking CTA → existing target `/contact?teacher=<name>` (no new PII surface).
- `Person` JSON-LD via `src/components/seo/structured-data.tsx`, public fields only.
- `generateMetadata` per teacher (title/description/OG).

### T5 — `src/app/(public)/teachers/content.tsx`: link card name + avatar → `/teachers/[id]`.

---

## Feature 2 — `content.tsx` featured-tier grid (UI-only, no DB)
Top 1–3 teachers (existing RPC sort order) get visual primacy; condense the rest.
Promote rating + total_sessions; demote languages/availability. "New teacher" badge stays muted.
Obey DESIGN.md Named Rules (One Metal, Gold-As-Text, Bilingual-First, No-Kicker).
Degrade cleanly at 0–2 teachers. RTL + WCAG-AA + reduced-motion.

---

## Verify gate (my lane — run BEFORE any PR)

1. **Migration applies** — `psql -f` the new migration; `\df+ get_public_teacher` shows grants = `{service_role=X}` only.
2. **Predicate parity (set-equality)** — the id set from `search_public_teachers(…large limit…)` == the id set for which `get_public_teacher(id)` returns non-null. Hidden `…00ff` returns 0 rows.
3. **Grants locked** — `has_function_privilege('anon', 'public.get_public_teacher(uuid)', 'EXECUTE')` = false; same for `authenticated`; `service_role` = true.
4. **Route renders (AC3 canary)** — `curl` logged-out `/teachers/00000000-0000-4000-a000-000000000037` → 200; grep body for `15550000037` / `Africa/Cairo` / `pending_review` → MUST be absent. `/teachers/00000000-0000-4000-a000-0000000000ff` → 404.
5. `npx tsc --noEmit` · `npm run lint` · `npm run build` green · `migration-safety` CI guard passes.

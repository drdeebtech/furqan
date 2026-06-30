# Phase 1 Data Model: Website Trust & Credibility Remediation

Only **additive** changes (expand phase). No existing column is dropped, renamed, retyped, or set NOT NULL.

## 1. `profiles` — new column (P1)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `is_test_account` | boolean | `NOT NULL DEFAULT false` | `true` = seed/E2E/test-fixture account; excluded from every public surface. |

**Backfill (one-time, bounded)**: set `true` where the joined `auth.users.email LIKE '%@furqan.test'`, or `full_name ILIKE '%(delete me)%'`, or `full_name ILIKE '%test teacher%'`. Migrations run with elevated rights and may read `auth.users`.

**Forward-fix**: `POST /api/auth/test-login` sets `is_test_account = true` on the profiles it upserts, so future test users are flagged at birth.

**RLS**: no policy change. The column is read inside existing public/teacher reads; it exposes no new data (boolean only).

## 2. Public teacher listing — gate (P1)

`getPublicTeachers()` (`src/app/(public)/teachers/page.tsx`) effective predicate becomes:

```
teacher_profiles.is_archived = false
AND teacher_profiles.is_accepting = true
AND teacher_profiles.cv_status = 'approved'
AND profiles.role = 'teacher'
AND profiles.is_test_account = false     -- NEW
```

Same predicate applies to any other public surface that lists or links a teacher (audit home/featured during tasks).

## 3. Teacher card display rule (P1)

Source field: `teacher_profiles.total_sessions` (integer, default 0; maintained by booking triggers — unchanged).

| Condition | Display |
|-----------|---------|
| `total_sessions = 0` | `معلم جديد` / `New teacher` badge (no zero counter) |
| `total_sessions > 0` | `{total_sessions} جلسة مكتملة` / `{n} completed sessions` (existing) |

## 4. `testimonials` — new table (P2)

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | uuid | PK default `gen_random_uuid()` |
| `author_name` | text | NOT NULL |
| `author_location` | text | nullable |
| `quote_ar` | text | NOT NULL |
| `quote_en` | text | nullable |
| `teacher_id` | uuid | nullable, FK → `profiles(id)` (only references a real teacher) |
| `is_published` | boolean | NOT NULL DEFAULT false |
| `display_order` | integer | NOT NULL DEFAULT 0 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

**RLS**: anon/public `SELECT` allowed only where `is_published = true`; `INSERT/UPDATE/DELETE` admin-only (ships in the same migration, per security rule "new tables ship policies in the same migration"). Admin CRUD action wraps `loudAction`.

**Integrity**: a published testimonial referencing a `teacher_id` must resolve to a real, listable teacher; if that teacher becomes non-listable, the testimonial must not surface the teacher. The render query must join against the full teacher-listing predicate (`is_archived = false AND is_accepting = true AND cv_status = 'approved' AND profiles.role = 'teacher' AND profiles.is_test_account = false`) so stale teacher associations can never leak — enforcement lives in the render layer, not RLS/policies, since the teacher-listability rules span multiple tables.

## 5. Language preference (P3) — no schema change

Effective language = explicit choice (cookie `furqan-lang` / localStorage) → else first-visit `Accept-Language` (non-Arabic → `en`) → else default `ar`. Stored client/cookie as today; no DB column.

## 6. Courses-nav signal (P3) — no schema change

Derived, cached count of `courses.status='published' = 0` → hide the Courses nav link. Recomputed via `unstable_cache`, not per render.

## Out of scope (no model change)

- Ratings/review **capture** (display-ready only).
- `cv_status` default change / auto-approve hardening (recommended follow-up D6).

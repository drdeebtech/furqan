# Implementation Plan: Teacher Searchable Marketplace

**Branch**: `feat/036-teacher-marketplace` | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)
**Closes**: #549

## Summary

Adds full-text keyword search + filter controls to the public `/teachers` page. Postgres `tsvector` with a GIN index on `teacher_profiles` powers instant search across Arabic and English bio text. A new `GET /api/teachers/search` route validates query params with zod and calls a Postgres RPC that handles the multi-table JOIN and ranking. The client component updates URL search params on every filter change (shareable, back-button safe) and hits the API route for real-time results. Skeleton loading prevents layout shift. All existing published-teacher gates (`is_archived`, `is_accepting`, `cv_status`, `is_test_account`) remain in force; this spec adds search on top, it does not loosen any gate.

## Technical Context

**Language/Version**: TypeScript 5 / Node 24 (Next.js App Router, canary)
**Primary Dependencies**: `@supabase/supabase-js` (already installed), `zod` (already installed), `lucide-react` (already installed), no new dependencies
**Storage**: PostgreSQL (Supabase) — new generated column + GIN index + DB function on existing tables
**Testing**: Vitest (unit), Playwright (e2e)
**Target Platform**: Vercel (server components + edge API)
**Performance Goals**: Search results < 1 s at 50k teacher rows; GIN index keeps FTS at O(log n)
**Constraints**: Expand-only DDL; no breaking column changes; RLS stays on for underlying tables; `createAdminClient()` for the public search route (same justification as existing listing); URL state drives filter; Arabic diacritics-insensitive via `unaccent` + `simple` text config
**Scale/Scope**: Sized for 50,000 users per constitution; pagination at 12/page; GIN index; ranking done in SQL not JS; no write amplification; no N+1 per card

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Domain Ownership | ✅ Pass | Read-only public surface; no domain writes; no new domain needed |
| II. Loud Failures | ✅ Pass | Read-only route; search errors surface as visible empty-state, not silent null |
| III. Atomic Critical Paths | ✅ Pass | No writes in this feature |
| IV. Auth at the Boundary | ✅ Pass | Route is intentionally public (anonymous visitors); zod validates all inputs; no userId from request body |
| V. Tracer-Bullet Adoption | ✅ Pass | Extends existing public listing; no new architectural pattern |
| 50k Scale | ✅ Pass | GIN index on tsvector; paginated at 12/page; ranking in SQL; no write amplification |
| Branch Hygiene | ✅ Pass | Branch cut from origin/main; draft PR same day; Closes #549 |
| Bilingual UX | ✅ Pass | All labels AR+EN; Arabic diacritics-insensitive; `dir="rtl"` on Arabic |

## Project Structure

### Documentation (this feature)
```text
specs/036-teacher-marketplace/
├── plan.md              ← this file
├── research.md          ← Phase 0
├── data-model.md        ← Phase 1
├── quickstart.md        ← Phase 1
├── contracts/
│   ├── search-api.md    ← GET /api/teachers/search contract
│   └── teacher-card.md  ← TeacherCard type contract
└── tasks.md             ← Phase 2 (from /speckit-tasks)
```

### Source Code Changes
```text
supabase/migrations/
└── 20260707000000_teacher_search_vector.sql   ← tsvector column + GIN index + search RPC

src/lib/supabase/
└── teacher-search.ts                          ← typed RPC wrapper (in src/lib for CI coverage)

src/app/api/teachers/search/
└── route.ts                                   ← GET handler; zod; calls teacher-search.ts

src/app/(public)/teachers/
├── page.tsx                                   ← update: accept searchParams; initial SSR fetch
└── content.tsx                                ← update: filter state, URL push, API calls

src/components/public/
├── teacher-search-input.tsx                   ← search box with 300ms debounce ("use client")
├── teacher-filter-bar.tsx                     ← filter sidebar/drawer ("use client")
└── teacher-card-skeleton.tsx                  ← loading skeleton (pure presentational)
```

## Key Design Decisions (Phase 0 research)

### D-001: Text search via Postgres tsvector with `unaccent` + `simple` config

**Decision**: Add a `search_vector` generated column (`tsvector`) to `teacher_profiles` using `to_tsvector('simple', ...)` over the bio fields. For name search, use `unaccent(profiles.full_name)` with `ILIKE` in the search RPC (not tsvector — name is in a separate table and is usually short). Arabic diacritics-insensitive because `simple` config normalises without stemming, and `unaccent` strips diacritics.

**Rationale**: `simple` text search config tokenises and lowercases without language-specific stemming — works correctly for both Arabic and English without a custom dictionary. Supabase bundles the `unaccent` extension (enabled project-wide). Name lives in `profiles`, not `teacher_profiles`, so a GIN index on a cross-table tsvector isn't feasible — `ILIKE '%term%'` on the name column is fast enough for 50k rows with an `unaccent` functional index.

**Alternatives rejected**: `pg_trgm` similarity (good for fuzzy matching but poor on Arabic short strings); Elasticsearch/Typesense (new vendor, no infrastructure, spec says Postgres only).

### D-002: Multi-table search via Postgres RPC, not chained Supabase client calls

**Decision**: Create a `search_public_teachers(query, language, gender, specialty, price_min, price_max, page, limit, rating_weight)` Postgres function that returns typed rows. The API route calls `supabase.rpc('search_public_teachers', params)`.

**Rationale**: The search query requires joining `teacher_profiles` + `profiles` + filtering by tsvector + name ILIKE + arrays (`languages @>`, `specialties @>`) + price range + ranking + pagination in a single pass. Chaining 3 Supabase `.from()` calls creates N+1 issues and can't push ORDER BY + LIMIT across the join. An RPC is a single SQL round-trip and can be unit-tested with pgTAP if needed.

**Alternatives rejected**: Chained client calls (N+1, can't rank across tables); GraphQL (not in stack).

### D-003: URL-driven state with `useRouter` + `useSearchParams`

**Decision**: `TeachersContent` reads initial filter state from URL search params (passed down as a prop from the Server Component). On any filter change, it calls `router.replace(newUrl, { scroll: false })` to update the URL, then calls `/api/teachers/search` to fetch results. Debounce on the text input (300 ms).

**Rationale**: URL state is free and shareable. The `replace` (not `push`) avoids polluting browser history on every keystroke. `scroll: false` prevents the page jumping to top on each filter change. This pattern already exists in the student dashboard (`useSearchParams` for tab state).

### D-004: `createAdminClient()` for the public search route

**Decision**: The `/api/teachers/search` route uses `createAdminClient()` (service role) to call the RPC.

**Rationale**: The existing `getPublicTeachers` in `page.tsx` already uses `createAdminClient()` for the same reason (comment: "public anonymous read of teacher listings, issue #523"). RLS on `teacher_profiles` restricts individual rows to teachers reading their own profile; the service role is the legitimate bypass for public reads of published profiles. The search RPC applies all the same business gates (`is_archived=false`, `is_accepting=true`, `cv_status='approved'`, `is_test_account=false`) in SQL — the bypass is scoped to those rows only.

### D-005: Specialty and language filter values from existing reference tables

**Decision**: Filter options for `specialty` and `language` are fetched from `teacher_specialties` and `TEACHER_LANGUAGES` constant (already in the codebase) — not hard-coded. The `gender` filter is a fixed two-value UI (Male / Female); price range is a numeric min/max input.

**Rationale**: The existing `TeachersContent` already fetches `specialtyLabels` from `teacher_specialties`. Reuse the same data; no new reference table needed.

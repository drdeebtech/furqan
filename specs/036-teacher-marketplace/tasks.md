# Tasks: Teacher Searchable Marketplace (Spec 036)

**Input**: `specs/036-teacher-marketplace/`
**Branch**: `feat/036-teacher-marketplace`
**Closes**: #549

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisable — touches different files with no dependency on incomplete tasks
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths included in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify branch is correct and existing page structure is understood before editing.

- [ ] T001 Run pre-work checks: `git branch --show-current` (confirm `feat/036-teacher-marketplace`), `gh issue view 549`, `gh pr list --search "549 in:title"`, `git log --diff-filter=D --summary | grep -i teacher` — confirm no retired prior work that would conflict
- [ ] T001b Open a draft PR immediately: `gh pr create --draft --title "feat: teacher searchable marketplace (spec 036)" --body "Closes #549"` — constitution §Branch Hygiene requires draft PR same day
- [ ] T002 Read `src/app/(public)/teachers/page.tsx` and `src/app/(public)/teachers/content.tsx` to understand: (a) existing `Teacher` type shape, (b) how bilingual strings are currently handled (inline ternary, i18n context, or static object) — follow the SAME pattern in all new components, (c) existing filter options already fetched (`specialtyLabels`), (d) `unstable_cache` call shape
- [ ] T003 [P] Verify `unaccent` extension is enabled in local Supabase: `supabase status` + `SELECT * FROM pg_extension WHERE extname = 'unaccent'`

**Checkpoint**: Understand the existing page before touching any file.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema addition + typed RPC wrapper. Both US1, US2, and US3 depend on these.

**⚠️ CRITICAL**: No user story work can begin until T004–T006 are complete.

- [ ] T004 Run `bash scripts/new-migration.sh teacher_search_vector` to generate the correctly-timestamped migration file, then write the full SQL from `specs/036-teacher-marketplace/data-model.md` into it: (a) `ALTER TABLE teacher_profiles ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (...)`, (b) `CREATE INDEX CONCURRENTLY teacher_profiles_search_vector_gin`, (c) `CREATE INDEX CONCURRENTLY profiles_full_name_search_idx`, (d) `CREATE OR REPLACE FUNCTION search_public_teachers(...)`, (e) `REVOKE EXECUTE FROM anon, authenticated; GRANT TO service_role`
- [ ] T005 Create `src/lib/supabase/teacher-search.ts` — export `TeacherCard` interface, `TeacherSearchResult` interface, `TeacherSearchParamsSchema` (zod), and `searchTeachers(params)` function that calls `supabase.rpc('search_public_teachers', ...)` via `createAdminClient()` and maps snake_case columns to camelCase `TeacherCard` fields (see `specs/036-teacher-marketplace/data-model.md` for types)
- [ ] T006 Apply migration locally and verify RPC works: `supabase db reset && bash scripts/dev-local-db-bootstrap.sh`, then `SELECT id, full_name FROM search_public_teachers()` in psql — confirm no error

**Checkpoint**: `searchTeachers({})` resolves without error; RPC is callable from service_role only.

---

## Phase 3: User Story 1 — Keyword Search (Priority: P1) 🎯 MVP

**Goal**: A visitor types a word (Arabic or English) in the search box and sees filtered teacher cards within 1 second — no page reload.

**Independent Test**: Load `/teachers`, type "tajweed" in the search box, confirm only matching teachers appear. Type "xyz_no_match" and confirm the empty state with a contact link appears. Clear the box and confirm all teachers return.

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create `src/components/public/teacher-search-input.tsx` — "use client" component with a text `<input>`, internal `useDebounce(value, 300)` hook (inline 4-line implementation, no library), calls `onChange(debouncedValue)` prop when value settles; Arabic `placeholder` + `aria-label`; triggers only when length is 0 or ≥2 chars (per spec edge-case)
- [ ] T008 [P] [US1] Create `src/components/public/teacher-card-skeleton.tsx` — pure presentational; renders 12 skeleton card placeholders matching the existing `TeacherCard` layout dimensions (avatar circle + 3 text lines + price); no client-side JS required; use Tailwind `animate-pulse`
- [ ] T009 [US1] Create `src/app/api/teachers/search/route.ts` — `export async function GET(req: Request)`: parse `req.url` into `URLSearchParams`, validate with `TeacherSearchParamsSchema.safeParse(Object.fromEntries(params))`, return 400 on failure; call `searchTeachers(parsed.data)` from `src/lib/supabase/teacher-search.ts`; return JSON response with `Cache-Control: public, max-age=30, stale-while-revalidate=300`; return 500 with `{ error: "Search temporarily unavailable" }` on DB error (do NOT leak the underlying error)
- [ ] T010 [US1] Update `src/app/(public)/teachers/page.tsx` — add `searchParams` prop (type: `Promise<{ q?: string; language?: string; gender?: string; specialty?: string; price_min?: string; price_max?: string; page?: string }>`, await it), pass the parsed values as `initialParams` prop to `TeachersContent`; keep existing `unstable_cache` SSR call for the non-JS initial render
- [ ] T011 [US1] Update `src/app/(public)/teachers/content.tsx` — add `initialParams` prop; initialise `query` state from `initialParams.q`; render `<TeacherSearchInput>` above the teacher grid; on query change call `/api/teachers/search?q=...` and update displayed teachers; show `<TeacherCardSkeleton>` while fetching; show empty-state `<div>` with Arabic + English help message and a link to `/contact` when results are empty; replace the local `Teacher` type with `TeacherCard` from `src/lib/supabase/teacher-search.ts`

**Checkpoint**: US1 independently testable — search box updates cards with no page reload; empty state visible on zero results; skeletons show on slow network.

---

## Phase 4: User Story 2 — Filters (Priority: P2)

**Goal**: Visitor narrows the teacher list by language, gender, specialty, and price range; filter state lives in the URL (shareable and back-button safe); mobile drawer opens on "Filters" tap.

**Independent Test**: Select "Female" gender filter, confirm only female teachers show. Copy URL, open new tab, confirm same filter is pre-applied. On a 375px viewport, tap "Filters" and confirm the drawer opens.

### Implementation for User Story 2

- [ ] T012 [US2] Create `src/components/public/teacher-filter-bar.tsx` — "use client" component; accepts `specialtyOptions: {value: string, label: string, labelAr: string}[]`, `languageOptions: {value: string, label: string}[]`, `filters: FilterState`, `onChange: (filters: FilterState) => void` props; renders: language `<select>`, gender radio buttons (Male/Female/Any), specialty `<select>`, price_min/price_max `<input type="number">`; validates price_min ≤ price_max inline (inline error message, fires no search); on mobile (< 768px via Tailwind `md:` breakpoint): hidden behind a "Filters" button that opens a `<div role="dialog">` overlay drawer from the bottom, closed by a backdrop click or "Done" button — CSS-only positioning (Tailwind `fixed inset-x-0 bottom-0`), no Radix/Headless UI; on desktop: visible as a sidebar column; all labels bilingual with `dir="rtl"` on Arabic text
- [ ] T013 [US2] Update `src/app/(public)/teachers/content.tsx` — add `FilterState` type `{ language?: string; gender?: string; specialty?: string; price_min?: number; price_max?: number; page: number }`; initialise from `initialParams`; render `<TeacherFilterBar>` alongside `<TeacherSearchInput>`; on any filter change call `router.replace(buildSearchUrl(query, filters), { scroll: false })` to update URL, then call `/api/teachers/search` with merged params; add "Clear all filters" button visible only when any non-default filter is active; fetch `specialtyOptions` from existing `specialtyLabels` already in scope
- [ ] T014 [US2] Update `src/app/(public)/teachers/page.tsx` — ensure all filter params (`language`, `gender`, `specialty`, `price_min`, `price_max`, `page`) from `searchParams` are forwarded to `TeachersContent` as `initialParams`; add `page` to SSR initial fetch params so deep-linked paginated filter URLs render correctly on first load

**Checkpoint**: US2 independently testable — filters narrow results; URL reflects active filters; "Clear all filters" resets; mobile drawer works.

---

## Phase 5: User Story 3 — Ranked Results (Priority: P3)

**Goal**: Default (no search, no filter) listing is ordered by completed-session count descending; keyword search additionally ranks name matches above bio matches.

**Independent Test**: Load `/teachers` with no query. Inspect the teacher cards — the teacher with the most completed sessions should appear first. Search for "tajweed" — if multiple teachers match, the one with more sessions should appear above the one with fewer (all else equal).

**Note**: Ranking logic is entirely in the Postgres RPC (`search_public_teachers` ORDER BY clause in the migration). The UI tasks here are:
1. Pagination controls to surface the ranked list across pages
2. Visual confirmation that ordering matches expectations

### Implementation for User Story 3

- [ ] T015 [P] [US3] Add `total` + `page` + `limit` to the state in `src/app/(public)/teachers/content.tsx` — read `total` from the API response; add a pagination `<nav aria-label="Teacher results pages">` below the teacher grid with Previous/Next buttons and page indicator (`Page N of M`); clicking a page button updates `filters.page`, syncs to URL as `?page=N`, and calls the search API; Previous is disabled on page 1, Next disabled on the last page
- [ ] T016 [US3] Verify that `src/app/(public)/teachers/page.tsx` passes `initialParams.page` to the `TeachersContent` SSR call so a direct link to `?page=2&gender=female` renders the correct page on first load
- [ ] T017 [US3] Add `rating_avg` display logic to the existing teacher card rendering in `src/app/(public)/teachers/content.tsx` — show star rating only when `ratingCount >= 3` (guarded inline), otherwise show session count badge only; this wires up the `ratingAvg`/`ratingCount` fields already returned by the RPC (spec 037 will populate real review counts)

**Checkpoint**: Pagination visible and functional; ranked order confirmed by comparing card positions vs session counts.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: RTL/accessibility hardening, type-check, build verification.

- [ ] T018 [P] Verify all new UI text (labels, ARIA, empty state, placeholder) exists in both Arabic and English in `src/app/(public)/teachers/content.tsx` and both new components; check `dir="rtl"` on Arabic strings and `dir="ltr"` on English
- [ ] T019 [P] Add `aria-label`, `aria-busy`, `aria-live="polite"` to the search input and results region in `src/app/(public)/teachers/content.tsx` so screen readers announce result updates; verify every filter control has a visible `<label>` associated by `htmlFor`
- [ ] T020 Run `npx tsc --noEmit` — fix every type error before proceeding
- [ ] T021 Run `npm run lint` — fix every lint error before proceeding
- [ ] T022 Run `npm run build` — verify Turbopack build succeeds with no "export not found" or server/client boundary errors (the known class of errors from `"use server"` barrel misuse)
- [ ] T023 Run `npm run test:unit` — confirm existing Vitest suite still passes (≥ 510 tests green)
- [ ] T024 Manual smoke test: `npm run dev`, open `http://localhost:3000/teachers`, exercise: keyword search → filter → clear → mobile drawer → pagination → share URL → back button

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 ✅ — **blocks all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 ✅
- **Phase 4 (US2)**: Depends on Phase 3 ✅ (filter bar extends the content component wired in US1)
- **Phase 5 (US3)**: Depends on Phase 3 ✅ (pagination is an extension of the results display)
- **Phase 6 (Polish)**: Depends on Phases 3–5 ✅

### Within Each Phase

- T007, T008 can run in parallel (different files, no cross-dependency)
- T009 depends on T005 (uses `searchTeachers`)
- T010, T011 depend on T009 (route must exist first)
- T012 can start as soon as T011 is in place (new component, no shared state)
- T013 depends on T012 (wires the filter bar into content)
- T015, T016, T017 in US3 are mostly independent of each other

---

## Parallel Example: Phase 2 (Foundational)

```bash
# T004 and T005 can run in parallel:
Task A: "Write migration SQL in supabase/migrations/20260707000000_teacher_search_vector.sql"
Task B: "Write typed RPC wrapper in src/lib/supabase/teacher-search.ts"
# T006 must wait for T004 to apply the migration
```

## Parallel Example: US1 Start

```bash
# T007 and T008 can run in parallel after T005:
Task A: "Create teacher-search-input.tsx"
Task B: "Create teacher-card-skeleton.tsx"
# Then T009 can start (needs teacher-search.ts from T005)
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Phase 1: Setup — confirm branch and read existing files
2. Phase 2: Migration + typed wrapper (T004–T006)
3. Phase 3: Search box + skeleton + API route + page/content updates (T007–T011)
4. **STOP and validate**: type "tajweed" → cards filter → empty state → skeleton visible
5. Phase 6: lint + build + test (T020–T024 subset)

### Incremental Delivery

1. MVP (US1) → validate search → demo
2. US2 (filters) → validate URL state + mobile drawer → demo
3. US3 (ranking + pagination) → validate ranked order → demo
4. Full polish pass → open PR

---

## Notes

- The `search_public_teachers` RPC ORDER BY already handles ranking (US3) — no JS-side sorting is needed
- `CONCURRENTLY` indexes in the migration are safe for Supabase CI (non-blocking)
- Do NOT call `npm run db:types` after this migration — `src/types/database.ts` is a hand-corrected layer (see spec 026); manually add only the new RPC signature if needed
- The `"use client"` directive lives only in leaf component files (`teacher-search-input.tsx`, `teacher-filter-bar.tsx`); never add it to a barrel or `page.tsx`
- After finishing T022, `npm run build` must succeed — if it fails, treat as a blocker before merging

# Tasks: SEO Audit Gaps

**Input**: `specs/027-seo-audit-gaps/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Branch**: `027-seo-audit-gaps`
**Tracking Issue**: [#517](https://github.com/drdeebtech/furqan/issues/517)
**Status**: Tasks-ready

---

## Phase 1: Setup (Branch Hygiene & Pre-Work)

**Purpose**: Satisfy constitution branch hygiene and avoid reworking prior SEO PRs.

- [ ] T001 Run `gh issue view 517` and record issue scope confirmation in `specs/027-seo-audit-gaps/plan.md`
- [ ] T002 Open draft PR for branch `027-seo-audit-gaps` linked to issue #517 and record PR URL in `specs/027-seo-audit-gaps/plan.md`
- [ ] T003 Run `gh pr list --state all --search "SEO #517"` and record no duplicate active PR in `specs/027-seo-audit-gaps/plan.md`
- [ ] T004 Run `git log --grep "SEO" --oneline` and `git log --diff-filter=D --summary -- src/app` and record relevant prior work in `specs/027-seo-audit-gaps/plan.md`

---

## Phase 2: Foundational SEO Helpers & Audit Baseline

**Purpose**: Establish shared facts and avoid duplicate/fabricated metadata.

- [ ] T005 [P] Audit existing metadata in `src/app/(public)/teachers/page.tsx`, `src/app/(public)/pricing/page.tsx`, `src/app/(public)/about/page.tsx`, `src/app/(public)/help/[slug]/page.tsx`, `src/app/(public)/courses/[slug]/page.tsx`, and `src/app/(public)/blog/[slug]/page.tsx`
- [ ] T006 [P] Audit existing structured data in `src/app/(public)/teachers/page.tsx`, `src/app/(public)/courses/page.tsx`, `src/app/(public)/courses/[slug]/page.tsx`, and `src/app/layout.tsx`
- [ ] T007 [P] Audit current crawl discovery in `src/app/sitemap.ts` and `src/app/robots.ts`, including `/subscribe` public/indexable status
- [ ] T008 Decide whether to add shared SEO helpers or keep route-local metadata in `specs/027-seo-audit-gaps/plan.md`

**Checkpoint**: Implementation can proceed with known existing SEO state and no duplicate schema strategy.

---

## Phase 3: User Story 1 - Public Pages Expose Complete Search Metadata (Priority: P1)

**Goal**: Core public pages have complete metadata, OG images, and dynamic child hreflang.

**Independent Test**: Inspect metadata for target pages and verify no P1 metadata fields missing.

- [ ] T009 [US1] Add complete metadata to `src/app/(public)/teachers/page.tsx`
- [ ] T010 [P] [US1] Add OpenGraph image route `src/app/(public)/pricing/opengraph-image.tsx`
- [ ] T011 [P] [US1] Add OpenGraph image route `src/app/(public)/about/opengraph-image.tsx`
- [ ] T012 [P] [US1] Add OpenGraph image route `src/app/(public)/help/[slug]/opengraph-image.tsx` with safe missing-article fallback
- [ ] T013 [US1] Add `alternates.languages` to dynamic metadata in `src/app/(public)/help/[slug]/page.tsx`
- [ ] T014 [US1] Add `alternates.languages` to dynamic metadata in `src/app/(public)/courses/[slug]/page.tsx`
- [ ] T015 [US1] Add `alternates.languages` and bilingual title/excerpt behavior to `src/app/(public)/blog/[slug]/page.tsx`

**Checkpoint**: P1 metadata and social-preview gaps for public pages are closed.

---

## Phase 4: User Story 2 - Course Pages Improve Rich-Result Eligibility (Priority: P1)

**Goal**: Course pages have breadcrumb schema and course detail social image.

**Independent Test**: Inspect `/courses`, `/courses/[slug]`, and course OG image output for valid fallbacks.

- [ ] T016 [US2] Add BreadcrumbSchema to `src/app/(public)/courses/page.tsx`
- [ ] T017 [US2] Add BreadcrumbSchema to `src/app/(public)/courses/[slug]/page.tsx`
- [ ] T018 [US2] Add course detail OpenGraph image route `src/app/(public)/courses/[slug]/opengraph-image.tsx` with course, teacher, cover-image, and missing-slug fallbacks
- [ ] T019 [US2] Verify `cover_image` alt behavior in `src/app/(public)/courses/[slug]/page.tsx` and update only if missing

**Checkpoint**: Course rich-result and sharing gaps are closed without fabricated course facts.

---

## Phase 5: User Story 3 - Crawl Discovery Surfaces Are Explicit and Safe (Priority: P1)

**Goal**: Sitemap and robots clearly expose public acquisition pages without auth-only leakage.

**Independent Test**: Inspect generated sitemap and robots outputs.

- [ ] T020 [US3] Add or document explicit course allow-list behavior in `src/app/robots.ts`
- [ ] T021 [US3] Decide `/subscribe` sitemap eligibility in `specs/027-seo-audit-gaps/plan.md` after checking route auth/noindex behavior
- [ ] T022 [US3] Update `src/app/sitemap.ts` only if `/subscribe` is public/indexable; otherwise leave excluded with rationale in `specs/027-seo-audit-gaps/plan.md`
- [ ] T023 [US3] Tune sitemap priorities for high-intent course URLs in `src/app/sitemap.ts` if supported by policy

**Checkpoint**: Crawl discovery is explicit and safe.

---

## Phase 6: User Story 4 - Trust Schemas and Bilingual Metadata Are Polished (Priority: P3)

**Goal**: Secondary SEO improvements ship without delaying P1/P2.

**Independent Test**: Inspect changed pages for fact-backed schema and bilingual metadata.

- [ ] T024 [P] [US4] Add metadata to `src/app/(public)/terms/page.tsx`
- [ ] T025 [P] [US4] Add metadata to `src/app/(public)/privacy/page.tsx`
- [ ] T026 [P] [US4] Add metadata to `src/app/(public)/cookies/page.tsx`
- [ ] T027 [US4] Add teacher `image` to Person JSON-LD in `src/app/(public)/teachers/page.tsx` only when verified image exists
- [ ] T028 [US4] Add WebSite root schema in `src/app/layout.tsx` only if canonical search action target is stable
- [ ] T029 [US4] Audit FAQ schema candidates for `src/app/(public)/pricing/page.tsx` and `src/app/(public)/help/page.tsx`; add FAQPage only where visible FAQ content exists
- [ ] T030 [US4] Record deferred optional trust-schema items in `specs/027-seo-audit-gaps/plan.md` when facts are unavailable

**Checkpoint**: P3 trust/bilingual polish is complete or explicitly deferred.

---

## Phase 7: Verification & Close-Out

**Purpose**: Prove SEO changes compile, build, and match issue #517 scope.

- [ ] T031 Run `npx tsc --noEmit`
- [ ] T032 Run `npm run lint`
- [ ] T033 Run `npm run build`
- [ ] T034 Run `npm run specs:index`
- [ ] T035 Run manual metadata/OG/schema/sitemap/robots checks from `specs/027-seo-audit-gaps/quickstart.md`
- [ ] T036 Run `/speckit-analyze` prerequisites: `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks`
- [ ] T037 Update issue #517 checklist status in PR body or final PR comment

---

## Dependencies & Execution Order

- Phase 1 blocks implementation.
- Phase 2 blocks route edits.
- US1 and US2 can run in parallel after Phase 2.
- US3 depends on Phase 2 and can run after `/subscribe` decision.
- US4 can run after Phase 2 but is lower priority than P1/P2.
- Phase 7 depends on selected stories complete.

## Parallel Opportunities

- T005-T007 parallel audit tasks.
- T010-T012 parallel OG route tasks.
- T024-T026 parallel legal metadata tasks.

## MVP Scope

MVP = Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 7. This closes all HIGH-priority issue #517 gaps, including the `/subscribe` sitemap decision.

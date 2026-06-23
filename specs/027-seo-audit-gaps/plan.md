# Implementation Plan: SEO Audit Gaps

**Branch**: `027-seo-audit-gaps` | **Date**: 2026-06-23 | **Spec**: [spec.md](spec.md)
**Tracking Issue**: [#517](https://github.com/drdeebtech/furqan/issues/517)
**Input**: Feature specification from `specs/027-seo-audit-gaps/spec.md`

---

## Summary

Close the remaining SEO audit gaps from issue #517 without reworking prior SEO PRs #512/#513/#515. The implementation focuses first on public-page metadata, OpenGraph images, hreflang alternates, and course rich-result eligibility, then handles crawl discovery and trust-schema polish. All output must be deterministic, bilingual where data exists, and free of generated Quran text or fabricated religious/business claims.

## Technical Context

**Language/Version**: TypeScript strict, Node 24, Next.js App Router  
**Primary Dependencies**: Next.js Metadata API, dynamic `opengraph-image.tsx`, JSON-LD script blocks, existing Supabase reads for published content  
**Storage**: Existing Supabase content tables only; no migrations  
**Testing**: `npx tsc --noEmit`, `npm run lint`, `npm run build`; focused metadata/route inspection where practical  
**Target Platform**: Public Next.js marketing routes on Vercel  
**Project Type**: Web application SEO/public routing feature  
**Performance Goals**: Metadata and OG image generation must avoid unbounded queries; dynamic routes fetch only needed row by slug  
**Constraints**: No Quran text generation; no fabricated schema fields; preserve PRs #512/#513/#515; no new env vars; no auth-only pages in sitemap  
**Scale/Scope**: Public crawler traffic at 50k-user platform scale; no per-render DB writes; dynamic metadata reads remain slug-scoped

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Domain Ownership | PASS | Public SEO metadata only; no domain writes or new owner-domain. |
| Loud Failures | PASS | No mutating server actions. Metadata fallbacks must be explicit, not silent fabrication. |
| Atomic Critical Paths | PASS | No multi-table writes or side-effecting critical paths. |
| Auth at the Boundary | PASS | Public route metadata only; no session/auth logic. `/subscribe` sitemap decision must respect auth/noindex status. |
| Tracer-Bullet Adoption | PASS | Issue #517 is net-new multi-surface SEO work; spec/plan/tasks path used. |
| 50,000-user scale target | PASS | No write amplification; dynamic reads stay slug-scoped; no unbounded per-render analytics joins. |
| Branch Hygiene | PASS | Branch `027-seo-audit-gaps`; tasks must open draft PR same day and link issue #517. |

## Project Structure

### Documentation (this feature)

```text
specs/027-seo-audit-gaps/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/app/
├── layout.tsx
├── sitemap.ts
├── robots.ts
└── (public)/
    ├── about/page.tsx
    ├── about/opengraph-image.tsx
    ├── pricing/page.tsx
    ├── pricing/opengraph-image.tsx
    ├── teachers/page.tsx
    ├── courses/page.tsx
    ├── courses/[slug]/page.tsx
    ├── courses/[slug]/opengraph-image.tsx
    ├── help/[slug]/page.tsx
    ├── help/[slug]/opengraph-image.tsx
    ├── blog/[slug]/page.tsx
    ├── terms/page.tsx
    ├── privacy/page.tsx
    └── cookies/page.tsx
```

**Structure Decision**: Keep SEO work colocated with App Router public routes and existing `sitemap.ts` / `robots.ts`. Do not add a new SEO abstraction unless duplication becomes material during implementation.

## Phase 0: Research

Research decisions:

- Use Next.js Metadata API for titles, descriptions, canonical URLs, and alternates.
- Use route-local `opengraph-image.tsx` files for missing social images.
- Use JSON-LD additions only when source facts exist on the page or in verified content records.
- Keep `/subscribe` sitemap inclusion as a decision task: include only if public/indexable; otherwise document exclusion.

Output: [research.md](research.md)

## Phase 1: Design

Design artifacts:

- [data-model.md](data-model.md): metadata surfaces, OG image surfaces, structured data blocks, crawl discovery rules.
- [quickstart.md](quickstart.md): manual verification checklist for metadata, OG images, hreflang, schema, sitemap, and robots.
- No external API contracts; this feature changes public metadata and generated route outputs.

## Implementation Approach

1. Branch hygiene and pre-work checks for issue #517.
2. P1 metadata/OG/hreflang fixes.
3. P1 course OG + breadcrumb schema.
4. P1 crawl discovery decisions for `/subscribe` sitemap safety plus robots/sitemap updates.
5. P3 trust-schema and bilingual metadata polish.
6. Verification: typecheck, lint, build, targeted route/metadata inspection, specs index.

## Deferred Work

- Optional root OG motif redesign.
- Optional Organization founder/foundingDate if verified facts are provided.
- Optional JobPosting schema for `/teach-with-us` only if job facts are present and stable.

## Complexity Tracking

No constitution violations or justified complexity exceptions.

## Pre-Work Log

### T001 — Issue #517 scope confirmation (2026-06-23)

`gh issue view 517` confirmed: the issue is the source of truth and maps 1:1 to `tasks.md`. Prior SEO PRs #512/#513/#515 are **verified correct — no rework**. Scope buckets:

- **HIGH → P1** (US1/US2/US3): `/teachers` metadata; course OG image; OG images for `/pricing`, `/about`, `/help/[slug]`; child-page hreflang (`courses/[slug]`, `help/[slug]`, `blog/[slug]`); `/subscribe` sitemap decision; BreadcrumbSchema on `/courses` + `/courses/[slug]`.
- **MEDIUM → P3/US4**: robots course allow-list; WebSite root schema (searchAction); verify `/courses/[slug]` cover_image `alt` (listing fixed in 0c0a402); metadata on `/terms`/`/privacy`/`/cookies`; per-teacher Person `image`; FAQ schema audit for `/pricing`+`/help`; sitemap priority tuning.
- **LOW → US4 polish / deferred**: blog `title_en`/`excerpt_en` bilingual (mirror help/[slug] pattern from 2655c4f); optional root OG motif; optional Org `founder`/`foundingDate`; optional `/teach-with-us` JobPosting.

Constraint reaffirmed by issue: do not fabricate schema facts, reviews, ratings, or Quran text.

## Implementation Decisions & Deferred Work (2026-06-23)

**OG-image Arabic constraint (T010–T012, T018).** `@vercel/og`'s Bidi pipeline crashes *uncatchably* (in the response stream, past any try/catch) on certain Arabic GSUB lookup tables — a documented production incident (root `src/app/opengraph-image.tsx`, Sentry NEXTJS-9). All new OG routes therefore avoid rendering DB Arabic: pricing/about/help use Latin branded cards; the course route prefers `title_en` + the cover raster with a Latin fallback (blog-style try/catch + Sentry). Teacher Arabic names and Arabic course titles are intentionally not drawn into OG images. Re-enabling Arabic requires bundling a Cairo/Noto font with simpler GSUB tables via `ImageResponse({ fonts })`.

**T021 — `/subscribe` excluded from sitemap (decided).** `src/app/subscribe/page.tsx` is **both** `robots: { index: false, follow: false }` **and** auth-gated (redirects to `/login` without a session; requires a `?plan=` param). Including it would create a misleading index entry. Left out of `sitemap.ts`; also added to `robots.ts` disallow for explicitness. Satisfies FR-006 / SC-005.

**Already-satisfied tasks (verify-only, no change):**
- **T024–T026** — `/terms`, `/privacy`, `/cookies` already export `metadata` with title + description + canonical.
- **T027** — `teachers/page.tsx` already emits Person `image` conditionally (`...(tch.avatarUrl ? { image } : {})`), with no fabrication when absent.
- **T019** — course detail renders no cover `<img>`; the teacher avatar correctly uses `alt=""` with the name in an adjacent `<span>` (decorative pattern). Nothing missing.

**T029 — no FAQPage added (honors FR-012).** Neither `/pricing` (no FAQ content) nor `/help` (a category index of articles, not an explicit visible Q&A list) contains DOM-visible question/answer pairs. Fabricating FAQPage there would repeat the policy violation that removed the old site-wide FAQSchema. The real DB-driven FAQ lives on `/contact`.

**Deferred (optional, facts/infra not yet available):**
- **T028 `searchAction`** — WebSite schema shipped without a sitelinks-searchbox `potentialAction`; no public `/search` endpoint exists, so a search target would be fabricated. Add when a public search route ships.
- Root OG Arabic motif (needs bundled Arabic font, per above).
- Organization `founder`/`foundingDate`; `/teach-with-us` JobPosting — only if verified facts are provided.
- Per-article/per-course Arabic OG titles — blocked on the `@vercel/og` Arabic-font fix.

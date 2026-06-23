# Feature Specification: SEO Audit Gaps

**Feature Branch**: `027-seo-audit-gaps`  
**Created**: 2026-06-23  
**Status**: Draft  
**Tracking Issue**: [#517](https://github.com/drdeebtech/furqan/issues/517)  
**Input**: Remaining SEO audit gaps after PRs #512/#513/#515: metadata, OpenGraph images, hreflang, schema, sitemap, robots, and social/search polish for public marketing surfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public pages expose complete search metadata (Priority: P1)

A search crawler or social preview bot reads high-value public pages and receives complete title, description, canonical URL, OpenGraph image, and language alternates where applicable.

**Why this priority**: Missing metadata and social cards lower discoverability and click-through on core acquisition pages. Engineer lens: metadata must be generated deterministically. Platform lens: guardians need trustworthy search snippets before signup. Quran lens: no Quran text is generated or modified.

**Independent Test**: Inspect `/teachers`, `/pricing`, `/about`, `/help/[slug]`, `/courses/[slug]`, and `/blog/[slug]` metadata output and verify each target has required metadata without regressions to existing SEO PRs.

**Acceptance Scenarios**:

1. **Given** `/teachers` is crawled, **When** metadata is rendered, **Then** page has title, description, canonical URL, and existing Person JSON-LD remains valid.
2. **Given** `/pricing`, `/about`, or `/help/[slug]` is shared, **When** social metadata is resolved, **Then** each page has an OpenGraph image appropriate to that page.
3. **Given** child pages under courses, help, or blog are crawled, **When** metadata is generated, **Then** each page exposes `ar`, `en`, and `x-default` language alternates.

---

### User Story 2 - Course pages improve rich-result eligibility (Priority: P1)

A crawler reads course pages and receives course-specific OpenGraph media plus breadcrumb schema for course navigation.

**Why this priority**: Course pages are core acquisition surfaces. Rich media and breadcrumbs improve SERP presentation and trust.

**Independent Test**: Inspect `/courses` and a valid `/courses/[slug]`; verify breadcrumb schema exists and course detail social image includes course-specific context with safe fallback behavior.

**Acceptance Scenarios**:

1. **Given** `/courses` is crawled, **When** structured data is read, **Then** BreadcrumbSchema describes the page path.
2. **Given** `/courses/[slug]` is crawled, **When** structured data is read, **Then** BreadcrumbSchema describes the path to that course.
3. **Given** a course detail page is shared, **When** OpenGraph image generation runs, **Then** the image uses course title, teacher context when available, cover image when available, and a safe fallback for missing slug or missing media.

---

### User Story 3 - Crawl discovery surfaces are explicit and safe (Priority: P1)

A search crawler reads sitemap and robots rules and receives clear, accurate discovery hints for public pages while auth-gated pages are not exposed by accident.

**Why this priority**: Discovery hints help crawlers find public pages, but incorrect inclusion of auth-gated pages can create low-quality or misleading index entries.

**Independent Test**: Inspect sitemap and robots output; verify public course pages are represented clearly and `/subscribe` is included only if confirmed public and useful to index.

**Acceptance Scenarios**:

1. **Given** robots rules are read, **When** course URLs are evaluated, **Then** public course routes are explicitly allowed or documented as intentionally crawlable through default policy.
2. **Given** sitemap is generated, **When** `/subscribe` eligibility is evaluated, **Then** it is included only if public; if auth-gated or noindex, it remains excluded with rationale.
3. **Given** sitemap priorities are generated, **When** high-engagement acquisition pages are compared to generic pages, **Then** courses can receive appropriately higher priority if supported by sitemap policy.

---

### User Story 4 - Trust schemas and bilingual metadata are polished (Priority: P3)

Search engines receive richer trust and bilingual metadata on secondary public surfaces without blocking P1 acquisition fixes.

**Why this priority**: These are useful polish items but less urgent than missing core metadata and course rich results.

**Independent Test**: Inspect legal pages, blog detail metadata, teacher schema, root WebSite schema, FAQ schema candidates, and optional trust schemas; verify changes are additive and do not fabricate facts.

**Acceptance Scenarios**:

1. **Given** `/terms`, `/privacy`, or `/cookies` is crawled, **When** metadata is rendered, **Then** each page has title, description, and canonical URL.
2. **Given** a blog post has English title or excerpt data, **When** metadata is generated, **Then** bilingual metadata mirrors existing help-page pattern.
3. **Given** teacher profile data is used in Person JSON-LD, **When** image data is available, **Then** `image` is included; when absent, no fabricated image is emitted.
4. **Given** FAQ schema is considered for `/pricing` or `/help`, **When** page content does not contain explicit FAQ content, **Then** no FAQPage schema is fabricated.

### Edge Cases

- Course slug missing, unpublished, or lacking cover image.
- Teacher has no avatar or image field.
- Help/blog localized fields are partially missing.
- `/subscribe` is auth-gated, noindex, or semantically unsuitable for sitemap inclusion.
- Existing metadata from PRs #512/#513/#515 must not regress.
- JSON-LD must not include fabricated claims, reviews, ratings, Quran text, or unavailable business facts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST add complete metadata for `/teachers`, including title, description, canonical URL, and preservation of existing Person JSON-LD.
- **FR-002**: System MUST provide page-appropriate OpenGraph images for course detail pages, `/pricing`, `/about`, and `/help/[slug]`.
- **FR-003**: Course detail OpenGraph image behavior MUST handle missing slug, missing course, missing teacher, or missing media with safe fallback output.
- **FR-004**: System MUST add child-page language alternates for `courses/[slug]`, `help/[slug]`, and `blog/[slug]` with `ar`, `en`, and `x-default` entries.
- **FR-005**: System MUST add BreadcrumbSchema to `/courses` and `/courses/[slug]` without conflicting with existing structured data.
- **FR-006**: System MUST decide `/subscribe` sitemap eligibility based on whether it is public and indexable; auth-gated or noindex behavior MUST keep it excluded with documented rationale.
- **FR-007**: System MUST make course crawl policy explicit in robots or document why default crawlability is sufficient.
- **FR-008**: System MUST add metadata to `/terms`, `/privacy`, and `/cookies` with title, description, and canonical URL.
- **FR-009**: System MUST improve blog detail metadata to use bilingual title/excerpt fields when available, mirroring existing help-page bilingual behavior.
- **FR-010**: System MUST include teacher image in Person JSON-LD only when a verified image field exists; it MUST NOT fabricate image URLs.
- **FR-011**: System MUST add WebSite root schema only if search action target and site URL are stable and canonical.
- **FR-012**: System MUST add FAQPage schema only to pages with explicit FAQ content present on the page.
- **FR-013**: System MUST preserve Quran integrity: no Quran text, ayah ranges, tajweed marks, or surah facts may be generated or modified by this SEO work.
- **FR-014**: System MUST preserve existing SEO fixes from PRs #512/#513/#515 unless a change is explicitly justified in this spec or plan.

### Key Entities *(include if feature involves data)*

- **Metadata surface**: Public route needing title, description, canonical URL, alternates, or social media fields.
- **OpenGraph image surface**: Page-specific social preview image with fallback behavior.
- **Structured data block**: JSON-LD object such as Person, BreadcrumbList, WebSite, FAQPage, Organization, or JobPosting.
- **Crawl discovery rule**: Sitemap or robots entry that affects crawler discovery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of HIGH-priority issue #517 checklist items have explicit implementation tasks or documented exclusion rationale.
- **SC-002**: Target public pages render title, description, canonical URL, and applicable alternates with 0 missing P1 metadata fields.
- **SC-003**: OpenGraph image endpoints for targeted pages return valid image responses or safe fallbacks for 100% of tested missing-data cases.
- **SC-004**: Structured data validation reports 0 syntax errors for changed JSON-LD blocks.
- **SC-005**: Sitemap and robots outputs contain no auth-only or noindex pages introduced by this feature.
- **SC-006**: Manual audit confirms 0 generated Quran text or fabricated religious claims in changed metadata/schema.

## Assumptions

- Issue #517 is source of truth for scope and priority.
- Prior SEO PRs #512, #513, and #515 are correct and should not be reworked.
- `NEXT_PUBLIC_APP_URL` or existing site URL helpers provide canonical origins.
- Arabic remains primary public-page language; English metadata is additive where data exists.
- `/subscribe` eligibility is a decision task, not assumed public.

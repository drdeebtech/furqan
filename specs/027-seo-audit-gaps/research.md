# Research: SEO Audit Gaps

## Decision 1: Use Route-Local Metadata and OG Assets

**Decision**: Add metadata and `opengraph-image.tsx` files near affected App Router routes.

**Rationale**: Route-local SEO keeps ownership clear, avoids a central metadata switchboard, and matches existing `blog/[slug]/opengraph-image.tsx` precedent.

**Alternatives considered**:

- Central SEO registry: rejected unless duplication becomes material.
- Static shared OG image for all pages: rejected for course/help pages that need page-specific context.

## Decision 2: Hreflang on Dynamic Children

**Decision**: Add `alternates.languages` on dynamic child metadata for courses, help, and blog.

**Rationale**: Root/layout alternates do not guarantee correct canonical child-page alternates. Child metadata should emit slug-specific URLs.

**Alternatives considered**:

- Rely only on layout alternates: rejected because issue #517 identifies child-page gap.

## Decision 3: JSON-LD Must Be Fact-Backed

**Decision**: Add BreadcrumbSchema, WebSite schema, FAQPage, Person image, or optional trust schemas only when facts are already present and verified.

**Rationale**: SEO schema with fabricated claims creates trust and compliance risk. Quran integrity also forbids generated religious claims.

**Alternatives considered**:

- Generate generic FAQ or teacher image data: rejected as fabrication.

## Decision 4: `/subscribe` Sitemap Inclusion Is Conditional

**Decision**: Treat `/subscribe` as a decision item. Include only if public and indexable; otherwise document exclusion.

**Rationale**: Auth-gated or noindex funnel pages should not be exposed through sitemap because they create weak index entries.

**Alternatives considered**:

- Always include: rejected until public/indexable status is verified.
- Always exclude: rejected because issue #517 asks to verify eligibility.

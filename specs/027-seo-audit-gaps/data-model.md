# Data Model: SEO Audit Gaps

This feature has no new database tables.

## Entities

### Metadata Surface

- **Represents**: Public route needing title, description, canonical URL, alternates, OpenGraph metadata, or Twitter metadata.
- **Examples**: `/teachers`, `/pricing`, `/about`, `/help/[slug]`, `/courses/[slug]`, `/blog/[slug]`, legal pages.
- **Rules**: Canonical URLs must be stable; bilingual fields used only when available.

### OpenGraph Image Surface

- **Represents**: Route-specific social preview image endpoint.
- **Examples**: `/courses/[slug]/opengraph-image.tsx`, `/pricing/opengraph-image.tsx`, `/about/opengraph-image.tsx`, `/help/[slug]/opengraph-image.tsx`.
- **Rules**: Must have safe fallback for missing dynamic content. Must not fabricate teacher/course facts.

### Structured Data Block

- **Represents**: JSON-LD object emitted on public pages.
- **Types in scope**: BreadcrumbList, Person image extension, WebSite, FAQPage if visible FAQ content exists.
- **Rules**: Must be syntactically valid and fact-backed.

### Crawl Discovery Rule

- **Represents**: Sitemap or robots policy affecting crawler discovery.
- **Examples**: course URL priorities, course allow-list, `/subscribe` inclusion/exclusion decision.
- **Rules**: No auth-only/noindex pages in sitemap.

## Relationships

- Metadata surfaces may have one OpenGraph image surface.
- Course pages have metadata, OG image, breadcrumb schema, sitemap entry, and robots policy exposure.
- Help/blog dynamic pages have metadata alternates and may have OG image where scoped.

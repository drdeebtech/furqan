# Quickstart: SEO Audit Gaps

## Verify Metadata

1. Inspect `/teachers`, `/pricing`, `/about`, `/help/[slug]`, `/courses/[slug]`, and `/blog/[slug]`.
2. Confirm title, description, canonical URL, and expected alternates exist.
3. Confirm no prior SEO fixes from #512/#513/#515 regressed.

## Verify OpenGraph Images

1. Request each new `opengraph-image` route.
2. Confirm valid image response.
3. Test missing dynamic slug/media fallback for course/help images.

## Verify Structured Data

1. Inspect JSON-LD blocks on changed pages.
2. Validate syntax.
3. Confirm no fabricated reviews, ratings, teacher images, Quran text, or religious claims.

## Verify Crawl Discovery

1. Inspect `sitemap.xml` output.
2. Confirm no auth-only or noindex `/subscribe` entry unless explicitly proven public/indexable.
3. Inspect `robots.txt` output for public course crawl clarity.

## Required Commands

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run specs:index
```

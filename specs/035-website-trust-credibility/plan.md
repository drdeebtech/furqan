# Implementation Plan: Website Trust & Credibility Remediation

**Branch**: `035-website-trust-credibility` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/035-website-trust-credibility/spec.md`

## Summary

Remove the production trust defects found in the 2026-06-30 seven-persona review, P1 first and shippable on its own. The dominant defect is **test/seed teacher accounts appearing on the public `/teachers` page**. Root cause (verified in code): the public query `getPublicTeachers()` already gates on `cv_status='approved' AND is_accepting=true AND is_archived=false`, but auto-created `teacher_profiles` **default `cv_status` to `approved`**, so a seeded/E2E `@furqan.test` teacher is born approved and slips through. Because `profiles` has **no email column** and the anonymous public read cannot see `auth.users` under RLS, the durable fix is a **`profiles.is_test_account` flag** the public query can filter on, backfilled once from `auth.users.email LIKE '%@furqan.test'` (and the known "(DELETE ME)" rows), with the test-login route setting it going forward. Then the lower-priority slices: honest "New teacher" treatment, courses-nav gating on a published count, EN-first detection for non-Arabic visitors, authentic testimonials, and institutional credibility surfaces.

## Technical Context

**Language/Version**: TypeScript (strict), Next.js App Router (canary), React 19
**Primary Dependencies**: Supabase (Postgres/Auth/RLS), Tailwind, existing i18n context (`src/lib/i18n/*`)
**Storage**: Supabase Postgres. Relevant tables: `profiles`, `teacher_profiles`, `courses`. New: `testimonials` (US3, P2).
**Testing**: Vitest (`npm run test:unit`) for the query gate + "New" rule; Playwright (`npm test`) for the public-page regression.
**Target Platform**: Vercel (SSR + server actions), PWA, full RTL/Arabic.
**Project Type**: Web application (Next.js monolith — `src/app` UI + `src/lib` domain/views).
**Performance Goals**: Public teacher list and courses-nav signal stay cached via `unstable_cache` (no per-render DB work at 50k users).
**Constraints**: Expand/contract migrations only; Arabic remains the canonical default locale (Bilingual-UX rule); no Quran-text change; identity from session, never request input.
**Scale/Scope**: 50,000-user target. Teacher set is small and already filtered+cached; the new column adds one indexed predicate. No write amplification, no unbounded fan-out.

### Verified code anchors (from Phase 0 recon)

- Public list: `getPublicTeachers()` in `src/app/(public)/teachers/page.tsx:15-111` (3-step query; gate at lines ~23-25, role join ~55).
- Card render incl. session count: `src/app/(public)/teachers/content.tsx:142` (`{teacher.totalSessions} جلسة مكتملة`).
- Schema: `profiles` and `teacher_profiles` in `supabase/migrations/20260428000000_remote_baseline.sql` (`cv_status` enum `draft|pending_review|approved|rejected`; `is_accepting`, `is_archived`, `total_sessions`, `bio`/`bio_en`). `profiles` has **no email**.
- Test signal: `@furqan.test` (seed `scripts/seed_local_dev.sql:29-31`; E2E `e2e/student-booking-flow.spec.ts` via `POST /api/auth/test-login`, prod-disabled by 4 gates).
- Courses nav: `src/components/public/public-nav.tsx:18` (always-on link); empty state `src/app/(public)/courses/page.tsx:192-197`; courses gate `status='published'`.
- i18n: default Arabic in `src/lib/i18n/context.tsx:22`; server read `src/lib/i18n/server.ts`; toggle `src/lib/i18n/lang-toggle.tsx`. **No Accept-Language detection today.**
- Testimonials: hardcoded `REVIEWS` array `src/components/public/testimonials.tsx:7-16`, imported by teachers/about/home/services → same quotes everywhere.

## Constitution Check

*GATE: must pass before Phase 0; re-checked after Phase 1.*

| Principle / Constraint | Verdict | Notes |
|---|---|---|
| I. Domain Ownership | ✅ Pass | No new owner-domain. Teacher listing is a **read** (reads may stay in place per ADR-0002). New `testimonials` table is content, admin-owned via existing admin surface; no new canonical event. |
| II. Loud Failures | ✅ Pass | New mutations (admin testimonials CRUD, US3; admin "mark teacher published" stays as existing CV-approval flow) wrap `loudAction` + render `<ActionFeedback>`. Read paths add no silent `?? []`. |
| III. Atomic Critical Paths | ✅ N/A | No money/multi-table critical path. Migration backfill is a one-time bounded `UPDATE`. |
| IV. Auth at the Boundary | ✅ Pass | Public reads are anonymous and gated in-query; admin actions use `requireAdmin`. Domain reads receive no session. |
| V. Tracer-Bullet | ✅ Pass | Net-new, multi-PR → spec-kit (this). P1 ships as the first tracer slice; later slices generalize. |
| Bilingual UX | ✅ Pass (amended) | Constitution **v1.3.0** (2026-06-30) added a "Default-locale selection" clause explicitly permitting `Accept-Language` first-visit selection. Arabic stays canonical default; all surfaces stay bilingual; EN-first never removes Arabic. Owner-approved — no remaining gate. |
| Migration discipline (expand/contract) | ✅ Pass | Only **additive** DDL: `ADD COLUMN profiles.is_test_account boolean NOT NULL DEFAULT false`. No drop/rename/SET-NOT-NULL-on-existing/type-change. Will not trip `scripts/check-migration-safety.sh`. New migration via `./scripts/new-migration.sh`. |
| 50,000-user scale | ✅ Pass | New column is metadata-only default (no table rewrite in PG11+); backfill matches only test rows (bounded); list + courses-nav signal stay `unstable_cache`d; one extra indexed predicate, no per-render write, no unbounded fan-out. |
| Branch hygiene | ✅ Pass (enforced in tasks) | Branch cut from `origin/main`. `tasks.md` MUST start with: create tracking issue + open draft PR same day; PR body carries `Closes #<issue>`. Pre-work checks (`gh issue view`, `gh pr list`, `git log --grep`, `git log --diff-filter=D`) run before code. |

**No unjustified violations → Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/035-website-trust-credibility/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — profiles delta, testimonials, language pref
├── quickstart.md        # Phase 1 — how to verify each slice locally
├── contracts/
│   └── public-teacher-listing.md   # the public read contract (gate rules)
├── checklists/requirements.md       # from /speckit.specify
└── tasks.md             # /speckit.tasks (next command)
```

### Source Code (repository root) — files this feature touches

```text
src/app/(public)/teachers/page.tsx        # getPublicTeachers(): add is_test_account=false predicate (P1)
src/app/(public)/teachers/content.tsx     # "New teacher" treatment for total_sessions=0 (P1)
src/app/(public)/courses/page.tsx         # unchanged (already gates status='published')
src/components/public/public-nav.tsx      # gate Courses link on published-course count (P3)
src/components/public/testimonials.tsx    # render from vetted source, distinct + consistent (P2)
src/lib/i18n/server.ts                    # Accept-Language first-visit detection (P3)
src/app/api/auth/test-login/route.ts      # set is_test_account=true on test users (P1, forward-fix)
src/lib/views/ or src/lib/domains/teacher/* # if a featured-teacher read exists, apply same gate
supabase/migrations/<ts>_add_is_test_account.sql   # P1 expand migration + bounded backfill
supabase/migrations/<ts>_testimonials.sql          # P2 table + RLS
tests/ unit (vitest) + e2e (playwright)   # regression: no test teacher public; "New" not "0"
```

**Structure Decision**: Existing Next.js monolith. P1 is a query-gate + one additive migration + a card-copy change + a regression test — deliberately the smallest durable slice. Later slices are independent and layer on top.

## Phased delivery (slices = spec user stories)

- **P1 (ship first, standalone)** — `is_test_account` column + backfill + `getPublicTeachers()` predicate + test-login forward-fix + "New teacher" copy + regression tests. Closes the live leak. Independently mergeable.
- **P2** — verifiable teacher profile fields surfaced (bio/bio_en, credential, languages, availability, price already in schema; wire any missing display) + `testimonials` table replacing the hardcoded array (distinct, consistently attributed, admin-managed).
- **P3** — courses-nav gating on published count; Accept-Language first-visit detection.
- **P4** — institutional credibility surfaces (leadership/org/safeguarding/privacy/partnership contact) — content-driven.

## Complexity Tracking

> No constitution violations — section intentionally empty.

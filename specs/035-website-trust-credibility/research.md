# Phase 0 Research: Website Trust & Credibility Remediation

All "NEEDS CLARIFICATION" were resolved in `/speckit.clarify` (see spec `## Clarifications`). This file records the **technical** decisions that turn those answers into a buildable design, grounded in the verified code anchors in `plan.md`.

## D1 — How to make the public teacher list default-deny against test accounts

**Decision**: Add `profiles.is_test_account boolean NOT NULL DEFAULT false`; backfill `true` for `auth.users.email LIKE '%@furqan.test'` and the known `(DELETE ME)` rows; add `.eq('is_test_account', false)` to `getPublicTeachers()`; set it `true` from the test-login route for future test users.

**Rationale**:
- The intended allow-list already exists (`cv_status='approved' AND is_accepting=true AND is_archived=false`). The defect is that auto-created `teacher_profiles` **default `cv_status='approved'`**, so seed/E2E teachers are born approved.
- A read-time email-domain exclusion is **not viable**: `profiles` has no email column, and the anonymous public read cannot join `auth.users` under RLS. A boolean the public query already selects is the only clean, performant signal.
- A flag also covers non-teacher test rows (test students) reused elsewhere, and is reusable by any future public surface.

**Alternatives considered**:
- *Deny-list on name/email patterns at read time* — rejected: profiles lacks email; name regex (`%test%`) is fragile and fails open.
- *Change `cv_status` default to `pending_review`* — deeper "no auto-approve" hardening; **out of P1 scope** because the review only surfaced *test* teachers, not unvetted real ones, and the default change has onboarding blast radius. Recorded as a recommended follow-up (see D6), not done here.
- *One-time delete of the rows* — rejected by the clarified decision: must be structural so a new test row can never re-leak.

## D2 — Migration safety & 50k scale

**Decision**: Single additive migration via `./scripts/new-migration.sh add_is_test_account`. `ADD COLUMN ... NOT NULL DEFAULT false` (metadata-only in PG ≥11, no table rewrite). Bounded one-time `UPDATE ... FROM auth.users` matching only test rows. No index initially (the list is already filtered by `cv_status`+`is_accepting` to a tiny set and `unstable_cache`d); add a partial index only if a future non-cached caller needs it.

**Rationale**: Expand/contract-safe (will not trip `scripts/check-migration-safety.sh`: "NOT NULL" inside `ADD COLUMN` ≠ `SET NOT NULL`). No write amplification; backfill is one-shot and bounded. Honors the 50k rule.

## D3 — "New teacher" treatment (zero sessions)

**Decision**: In `teachers/content.tsx`, when `total_sessions === 0` render a positive `معلم جديد / New teacher` badge instead of the literal `0 جلسة مكتملة`. Non-zero keeps the existing count.

**Rationale**: Matches the clarified answer; fixes the "reads as broken" complaint without hiding real new supply (cold-start protection).

## D4 — Courses-nav gating

**Decision**: Compute a cached published-courses count (`status='published'`) in the public layout/server and pass a `hasCourses` signal to `public-nav.tsx`; hide the Courses link when zero. Reuse the existing feature-flag plumbing (`useFeatureFlags`) shape so the link's visibility is data-driven, not hardcoded.

**Rationale**: Stops advertising an empty room (FR-009) and auto-restores the link when content exists. Cached → no per-render query at 50k.

## D5 — EN-first detection (Bilingual-UX-safe)

**Decision**: In `src/lib/i18n/server.ts` (and/or middleware), on a first visit with **no `furqan-lang` cookie**, read `Accept-Language`; if the top preference is clearly non-Arabic, set initial lang `en` and persist the cookie to avoid a hydration flash; otherwise keep Arabic. The toggle and explicit choice always win and persist.

**Rationale**: Honors FR-010/011 and widens the diaspora funnel while keeping Arabic the canonical default (constitution Bilingual-UX). Cookie-set on the server prevents an AR→EN flicker.

**Alternatives considered**: *Geo/IP detection* — rejected: heavier, less accurate than the browser's own preference, and privacy-heavier.

## D6 — Recommended follow-ups (explicitly out of THIS feature)

- Stop auto-approving newly created `teacher_profiles` (default `cv_status` to `pending_review`); make CV approval an explicit admin step. Trust hardening beyond the verified defect.
- Build a session-feedback → ratings capture pipeline (the deferred half of US2).
- A full B2B portal (US6 ships only credibility surfaces + a contact path).

## D7 — Testimonials authenticity

**Decision**: Replace the hardcoded `REVIEWS` array with an admin-managed `testimonials` table (RLS: public read of `is_published=true`, admin write). Seed it only with vetted, consistently-attributed entries the business confirms; remove the garbled/conflicting ones. Render several **distinct** testimonials; do not display an identical quote across pages.

**Rationale**: FR-007/008 — believable, attributable proof; no fabricated specifics. Admin-managed so it stays honest without a code deploy.

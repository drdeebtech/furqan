# Tasks: Website Trust & Credibility Remediation

**Feature**: `035-website-trust-credibility` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Branch**: `035-website-trust-credibility` (cut from `origin/main`)

Tests are **required** for User Story 1 (the contract in `contracts/public-teacher-listing.md` mandates regression tests) and included where they protect a trust invariant. Each user story is an independently testable, independently shippable slice. **User Story 1 is the MVP** and merges on its own, ahead of the rest.

Legend: `[P]` = parallelizable (different files, no incomplete dependency). `[US#]` = the user story the task serves.

---

## Phase 1: Setup (branch hygiene — constitution NON-NEGOTIABLE)

- [X] T001 Run the retired/duplicate pre-work checks and record results in the PR description: `gh issue list --search "teacher trust"`, `gh pr list --search "teachers test"`, `git log --grep="is_test_account" --oneline`, and `git log --diff-filter=D --oneline -- "src/app/(public)/teachers/**"` (the `--diff-filter=D` check is the only one that catches a *retired* version of this work)
- [X] T002 Create the tracking issue (title: "Trust & credibility remediation — public test-teacher leak + follow-ups") capturing the 7-persona findings and the P1→P4 slices; note its number as `#<issue>`
- [X] T003 Open a **draft PR** the same day from `035-website-trust-credibility` → `main` with body containing `Closes #<issue>` and the slice checklist (draft until US1 is green)

**Checkpoint**: branch is tracked by an issue and a same-day draft PR before any production code edit.

---

## Phase 2: Foundational (blocking prerequisites)

> None shared across stories. User Story 1 is itself the foundation and is intentionally self-contained; later stories layer on top without depending on each other. Proceed directly to Phase 3.

---

## Phase 3: User Story 1 — No fake/unfinished teachers appear publicly (Priority: P1) 🎯 MVP

**Goal**: A `profiles.is_test_account` flag makes the public teacher listing default-deny against test/seed accounts; zero-session real teachers show as "New". Closes the live production leak.

**Independent test**: Anonymous load of `/teachers` (and any featured-teacher surface) shows no `@furqan.test` / "Test Teacher" / "DELETE ME" profile; a real zero-session teacher appears as "New". Verified by the tasks below + `quickstart.md` P1.

### Tests first (red) — required by contract

- [X] T004 [P] [US1] Add failing unit test: `getPublicTeachers()` excludes a fixture teacher with `is_test_account = true` even when `cv_status='approved'` (INV-1/2/3), in `src/app/(public)/teachers/__tests__/get-public-teachers.test.ts`
- [X] T005 [P] [US1] Add failing unit test: a real teacher with `total_sessions = 0` is **included** and flagged "New" (INV-5), in the same test file
- [X] T006 [P] [US1] Add failing Playwright e2e: anonymous `/teachers` contains no `Test Teacher` / `DELETE ME` / `@furqan.test` text (INV-1/2/4), in `e2e/public-teachers-no-test-accounts.spec.ts`

### Migration (expand — additive only)

- [X] T007 [US1] Create the migration via `./scripts/new-migration.sh add_is_test_account`, then in `supabase/migrations/<ts>_add_is_test_account.sql`: `ALTER TABLE public.profiles ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;` (additive; will not trip `scripts/check-migration-safety.sh`)
- [X] T008 [US1] In the same migration, add the bounded one-time backfill: `UPDATE public.profiles p SET is_test_account = true FROM auth.users u WHERE u.id = p.id AND (u.email LIKE '%@furqan.test' OR p.full_name ILIKE '%(delete me)%' OR p.full_name ILIKE '%test teacher%');`
- [X] T009 [US1] Apply locally (`supabase migration up` or `scripts/dev-local-db-bootstrap.sh`) and run `npm run db:types`; reconcile the hand-corrected `src/types/database.ts` alias layer for the new `profiles.is_test_account` column (do not blind-regen — see spec 026)

### Implementation (green)

- [X] T010 [US1] Add `.eq("is_test_account", false)` to the `profiles` step of `getPublicTeachers()` in `src/app/(public)/teachers/page.tsx` (predicate per `contracts/public-teacher-listing.md`)
- [X] T011 [P] [US1] Render the "New teacher / معلم جديد" badge when `total_sessions === 0` (replace the bare `0 جلسة مكتملة`) in `src/app/(public)/teachers/content.tsx:142`
- [X] T012 [P] [US1] Forward-fix: set `is_test_account = true` on the profile upserted by `POST /api/auth/test-login` in `src/app/api/auth/test-login/route.ts` so future test users are flagged at birth
- [X] T013 [US1] Audit every other public surface that lists or links a teacher (home/featured, any `src/lib/views`/`src/lib/domains/teacher` read) and apply the same `is_test_account = false` predicate (INV-4); if none exist, record that in the PR

### Verify

- [X] T014 [US1] Run `npm run test:unit`, `npm test` (the new e2e), `npx tsc --noEmit`, `npm run lint`, and `npm run build` — all green; confirm T004–T006 now pass
- [ ] T015 [US1] Mark the draft PR ready; confirm CI `migration-safety` and `trufflehog` checks pass on the additive migration

**Checkpoint**: US1 is independently shippable — the live leak is closed and provably cannot recur.

---

## Phase 4: User Story 2 — Teacher profiles verifiable enough to choose from (Priority: P2)

**Goal**: Each public teacher shows photo/placeholder, bio (`bio`/`bio_en`), verifiable ijazah/riwayah, languages, availability, and price tier (schema fields already exist) — a chooser, not a directory.

**Independent test**: Open three real teacher cards; all six presentation elements render (dignified placeholders where data is genuinely missing).

- [X] T016 [P] [US2] Surface any missing presentation fields (bio/bio_en, credential/riwayah, languages, availability, price) on the teacher card in `src/app/(public)/teachers/content.tsx`, with dignified placeholders for missing values (do not hide the teacher — FR-002/FR-004). Concrete placeholder defaults (resolves analyze A2): missing photo → initials avatar (first letters of `full_name`/`full_name_ar`); missing price → `—`; missing availability → "Schedule on request / حسب الاتفاق"; missing bio → omit the bio block (no filler); optional `bio_en` absent → fall back to Arabic bio.
- [X] T017 [P] [US2] Present the credential as a specific, checkable claim (named riwayah/sanad) rather than a generic "certified" tag, in `src/app/(public)/teachers/content.tsx`
- [X] T018 [US2] Confirm no ratings are fabricated: ratings render only when real review data exists (gate the rating block on review count), in `src/app/(public)/teachers/page.tsx` / `content.tsx`
- [X] T019 [US2] Verify RTL/Arabic rendering of all new card elements; run `npm run build` + visual check at 320/768/1440

**Checkpoint**: a visitor can pick a teacher from public info alone (SC-002/SC-003).

---

## Phase 5: User Story 3 — Authentic, varied testimonials (Priority: P2)

**Goal**: Replace the hardcoded shared `REVIEWS` array with admin-managed, vetted, consistently-attributed testimonials; no identical quote repeated across pages; no fabricated specifics.

**Independent test**: Home/teachers/about show several distinct, consistently-attributed testimonials; no garbled name; no conflicting attribution.

- [X] T020 [US3] Create migration via `./scripts/new-migration.sh testimonials`: `testimonials` table per `data-model.md` **with RLS in the same migration** (public `SELECT` only where `is_published = true`; `INSERT/UPDATE/DELETE` admin-only)
- [X] T021 [US3] Apply locally + `npm run db:types`; reconcile `src/types/database.ts` aliases for `testimonials`
- [X] T022 [P] [US3] Replace the hardcoded array in `src/components/public/testimonials.tsx` with a read of published testimonials (distinct set, consistent attribution); ensure a referenced `teacher_id` resolves to a listable teacher or the teacher is not surfaced
- [X] T023 [US3] Admin CRUD for testimonials wrapped in `loudAction` with `<ActionFeedback>` (under `src/app/admin/...` + `src/lib/actions` or `src/lib/domains`), `requireAdmin` at the boundary
- [X] T024 [US3] Seed a few business-verified testimonials (no fabricated names/locations); remove the garbled/conflicting entries

**Checkpoint**: social proof is believable and attributable (FR-007/FR-008).

---

## Phase 6: User Story 4 — Never advertise an empty room (Priority: P3)

**Goal**: The Courses nav/footer link is hidden while zero courses are published, and returns automatically when content exists.

**Independent test**: With zero published courses the link is absent; publish one → it reappears.

- [ ] T025 [US4] Compute a cached published-courses count (`courses.status='published'`) server-side via `unstable_cache` in the public layout, in `src/app/(public)/layout.tsx` (or the existing feature-flag provider)
- [ ] T026 [US4] Gate the Courses link on that signal in `src/components/public/public-nav.tsx:18` and the footer; default-hidden when count is 0 (FR-009)
- [ ] T027 [US4] Verify: zero published → no link in nav/footer; publish one → link returns; `npm run build` green

**Checkpoint**: no promoted link reaches an empty page (SC-005).

---

## Phase 7: User Story 5 — Non-Arabic visitors not lost on arrival (Priority: P3)

**Goal**: First-visit `Accept-Language` detection picks English for clearly-non-Arabic visitors while Arabic stays the canonical default; explicit choice always wins and persists; no AR→EN flash.

**Independent test**: Visit with a non-Arabic browser language and no `furqan-lang` cookie → English, no flash; toggle to Arabic persists on reload.

- [ ] T028 [US5] On first visit (no `furqan-lang` cookie), read `Accept-Language` and set the initial lang + cookie server-side (non-Arabic top preference → `en`, else `ar`) in `src/lib/i18n/server.ts` and/or `middleware.ts` (set cookie to avoid hydration flash)
- [ ] T029 [US5] Ensure the explicit toggle/cookie/localStorage choice overrides detection and persists (FR-011); Arabic remains the default when preference is Arabic or absent (Bilingual-UX constitution)
- [ ] T030 [US5] Verify SSR `dir`/`lang` match the chosen locale with no hydration mismatch; `npm run build` green

**Checkpoint**: diaspora funnel widened without demoting Arabic (SC-006).

---

## Phase 8: User Story 6 — Institutional credibility & B2B path (Priority: P4)

**Goal**: Discoverable organization (leadership, identity, child-safeguarding, privacy posture) and a partnership contact path distinct from the personal email/WhatsApp.

**Independent test**: From a cold visit, locate all five institutional signals + a partnerships contact route.

- [X] T031 [P] [US6] Add named leadership + organizational identity content to `src/app/(public)/about/content.tsx` (business-supplied copy)
- [X] T032 [P] [US6] Add a child-safeguarding statement and ensure the privacy posture is discoverable (extend `src/app/(public)/privacy/page.tsx` and link it prominently)
- [X] T033 [US6] Add a partnerships/institutional contact path (e.g. a `?type=partnership` mode on `src/app/(public)/contact/page.tsx` or a dedicated section) distinct from consumer contact (FR-013)
- [X] T034 [US6] Link the institutional surfaces from nav/footer so they are discoverable from a cold visit (SC-007)

**Checkpoint**: an institution can verify the org and start a conversation.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T035 [P] Confirm no silent-fail patterns (`?? []` / `?? null` near Supabase calls) were introduced in any touched read; run the CI tripwire grep locally
- [ ] T036 [P] Update `SC-008`: re-run the seven-persona review against the deployed changes; record new scores in the PR (target avg ≥ 7.3 and the test-teacher defect resolved by all reviewers)
- [ ] T037 Ensure each merged slice leaves the branch in a PR-or-deleted state (branch hygiene); update the tracking issue checklist

---

## Phase 10: Negative-constraint & outcome verification (FR-014, SC-003)

> Explicit, regression-failing checks for the constraints `/speckit.analyze` flagged as only indirectly covered. Each must FAIL if the invariant breaks — not a doc assertion.

- [X] T038 [P] Assert the public teachers response exposes **no new or sensitive fields** after the gate change: snapshot the public payload shape in `src/app/(public)/teachers/__tests__/get-public-teachers.test.ts` and fail if any column beyond the existing public set (incl. accidental email/`is_test_account` leakage) appears (FR-014). Cross-cutting verification; depends on US1 (run after T010–T013) — required for the US1 MVP.
- [ ] T039 Test `testimonials` RLS in `e2e/` or a DB test: an anonymous client SELECT returns **only** `is_published = true` rows, and anonymous `INSERT`/`UPDATE`/`DELETE` is **denied** (FR-014 — no new public-data exposure). Cross-cutting verification; depends on US3 (T020).
- [ ] T040 Scope guard for Quran integrity (FR-014): confirm in the PR description, with the diff, that **no** Quran-domain table, ayah text, tashkeel/tajweed/waqf rendering, or `src/lib/quran/**` is touched by this feature; CI diff review backs the claim.
- [ ] T041 SC-003 validation: during the SC-008 re-review (T036), explicitly time the "choose a teacher to contact from public info, without registering" flow on the deployed build and record that it completes in **under 3 minutes**.

**Checkpoint**: FR-014 and SC-003 are now verified by tests/measurement, not assumption.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → before any code.
- **User Story 1 (Phase 3)** → the MVP; merge first, independently. Tests (T004–T006) before implementation (T010–T013).
- **User Stories 2–6** → each independent of the others; can be done in any order or in parallel after US1, by different people/branches. (Recommended priority order: US2/US3 → US4/US5 → US6.)
- Within US1: T007→T008→T009 (migration chain) before T010; T004–T006 (tests) before T010–T013; T014–T015 last.
- **Polish (Phase 9)** → after the slices it audits.

## Parallel Opportunities

- US1 tests T004, T005, T006 run in parallel `[P]`.
- After US1 merges, US2 / US3 / US4 / US5 / US6 are mutually independent and can run in parallel.
- Within US2: T016, T017 `[P]`. Within US6: T031, T032 `[P]`.

## Implementation Strategy

**MVP = User Story 1 only.** Ship it, merge it, redeploy — the production trust leak is closed and provably cannot recur. Everything else (US2–US6) is incremental trust/credibility uplift layered on afterward, each its own PR. Do not bundle US2–US6 into the US1 PR.

## Task Summary

- **Total tasks**: 41
- **Per story**: Setup 3 · Foundational 0 · US1 12 (T004–T015) · US2 4 · US3 5 · US4 3 · US5 3 · US6 4 · Polish 3 · Verification (FR-014/SC-003) 4 (T038–T041)
- **MVP scope**: US1 (T001–T015) + T038 — independently shippable
- **Tests**: US1 has 3 required regression tests (unit ×2 + e2e ×1) per the listing contract, plus the FR-014 payload-shape guard (T038); US3 adds an RLS denial test (T039)

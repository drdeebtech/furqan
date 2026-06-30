# Contract: Public Teacher Listing (P1)

The public-facing rule for which teachers may appear, and how, on any unauthenticated surface that lists or links a teacher: the teachers list, any featured-teacher area, the contact-prefill link (`/contact?teacher=…`), and machine-readable output (sitemap/SEO). Note: there is currently **no standalone public teacher-detail page** — teachers link to the contact prefill. Any such page added later inherits this same rule.

## Inclusion rule (default-deny allow-list)

A teacher profile is PUBLICLY VISIBLE **iff ALL** hold:

1. `profiles.role = 'teacher'`
2. `profiles.is_test_account = false`
3. `teacher_profiles.is_archived = false`
4. `teacher_profiles.is_accepting = true`
5. `teacher_profiles.cv_status = 'approved'`

Anything failing ≥1 condition is excluded. A newly created seed/test/fixture row defaults to `is_test_account = false` only if it is **not** a test account; the test-login route and the backfill set `true` for test accounts, so they fail rule (2) automatically — no manual cleanup.

## Display rule

- Missing photo / availability / price → render a dignified placeholder; the teacher is **still listed** (do not hide on incompleteness).
- `total_sessions = 0` → show `New teacher` / `معلم جديد`; never a bare `0` counter.
- Ratings shown **only** when real session-based rating data exists; never fabricated.

## Invariants (testable)

- INV-1: No profile with `is_test_account = true` appears on any public surface.
- INV-2: No `@furqan.test` account appears publicly (guaranteed via INV-1 + backfill + forward-fix).
- INV-3: A teacher with `cv_status != 'approved'` (e.g. `draft`/`pending_review`/`rejected`) never appears publicly.
- INV-4: The same rule applies identically on every surface that lists or links a teacher — the teachers list, any featured-teacher area, the contact-prefill link (`/contact?teacher=…`), and machine-readable/SEO output. (No standalone public teacher-detail page exists today; if added it inherits the rule.)
- INV-5: A real teacher with `total_sessions = 0` is visible and shown as "New".

## Regression tests (must exist before P1 merges)

- Unit (Vitest): given a fixture set including an `is_test_account = true` approved teacher, `getPublicTeachers()` excludes it (INV-1/2/3).
- Unit: a `total_sessions = 0` real teacher is included and flagged "New" (INV-5).
- E2E (Playwright): anonymous load of `/teachers` contains no `Test Teacher` / `DELETE ME` / `@furqan.test` profile (INV-1/2/4).

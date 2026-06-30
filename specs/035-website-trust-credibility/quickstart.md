# Quickstart: Verify Each Slice Locally

Local stack per `CLAUDE.md` (Supabase + `scripts/dev-local-db-bootstrap.sh`, `npm run dev`). The local seed (`scripts/seed_local_dev.sql`) creates `@furqan.test` teachers — perfect fixtures for the P1 gate.

## P1 — Test teachers never public

1. Seed: `psql -v ON_ERROR_STOP=1 -v allow_seed=1 "$LOCAL_DB" -f scripts/seed_local_dev.sql` (creates `teacher1@furqan.test` … approved).
2. Apply the migration (`supabase migration up` or the bootstrap) — adds `profiles.is_test_account`, backfills `@furqan.test` → `true`.
3. Visit `http://localhost:3000/teachers` → **no** `@furqan.test` / "Test Teacher" / "DELETE ME" profile appears.
4. Insert a non-test approved teacher with `total_sessions = 0` → it **appears**, shown as **New teacher / معلم جديد** (not "0 جلسة مكتملة").
5. `npm run test:unit` (gate + "New" rule) and `npm test` (Playwright `/teachers` regression) pass.

## P2 — Profiles + testimonials

- Open three real teacher cards → photo/placeholder, bio, credential, languages, availability, price all present.
- After the `testimonials` migration + a few vetted rows, home/teachers/about show **distinct, consistently-attributed** quotes (no identical quote repeated, no garbled name).

## P3 — Courses nav + EN-first

- With zero published courses, the Courses link is **absent** from nav/footer; publish one → link returns.
- Visit with a non-Arabic browser language and **no** `furqan-lang` cookie → site loads in English (no AR→EN flash); toggle to Arabic persists on reload.

## P4 — Institutional credibility

- From a cold visit, locate: named leadership, organizational identity, a child-safeguarding statement, a privacy posture, and a partnerships/contact path distinct from the personal email/WhatsApp.

## Definition of done (maps to spec Success Criteria)

- SC-001: anonymous crawl of home + `/teachers` shows **zero** test/unpublished profiles.
- SC-002: 100% of listed teachers show all six presentation elements (placeholders allowed).
- SC-005: no promoted nav/footer link reaches an empty page.
- SC-006: non-Arabic visitor reaches English within one action; choice persists.
- SC-008: re-run the seven-persona review → test-teacher defect resolved by all; avg ≥ 7.3.

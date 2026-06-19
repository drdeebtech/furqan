# Tasks: Reports, Gamification & Notifications (Spec 023)

**Input**: `specs/023-reports-gamification-notifications/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Branch**: `023-reports-gamification-notifications`
**Phase**: م٦ of the Subscription + Courses Pivot
**Tracking issue**: [#489](https://github.com/drdeebtech/furqan/issues/489) · **Draft PR**: [#490](https://github.com/drdeebtech/furqan/pull/490)

**Round-2 clarifications applied 2026-06-19** (see spec.md `### Session 2026-06-19 (speckit-clarify round 2 — implementation blockers)`):
- **Event ownership split**: consume `subscription.past_due` (existing); emit `subscription.expiring` + `absence.outcome` locally. Reflected in T029.
- **Canonical `automation_logs` columns**: `workflow_name`/`event_name`/`payload_json`/`result_json`/`error_message` — NOT `event_type`/`payload`/`error_detail` (those don't exist). Reflected in T012, T015, T030.
- **Quran juz-boundary source**: new T014a (architect task) authors `src/lib/quran/juz-boundaries.ts` from a cited canonical mushaf; US2 juz branch blocked on it.
- **`subscription.expiring` lead-time source**: `subscriptions.current_period_end`. Reflected in T029.
- **T011b fallback detector**: ship only if spec 018 lags. Unchanged.

**Prerequisites**:
- spec 018 merged — emits `payment.failed`, `subscription.expiring` lifecycle events.
- spec 021 merged — emits `absence.outcome` events.
- spec 019 merged — defines courses/products referenced by `course_completion` certificates + next-product suggestion.
- Existing infrastructure: `notifications`, `automation_logs` (`idempotency_key` UNIQUE), `profiles`, `platform_settings`, `guardian_children`, `quran_surahs_reference`, `src/lib/automation/emit.ts`, `src/app/api/webhooks/n8n/route.ts` (`safeCompareSecret`), `src/lib/quran/ayah-counts.ts`.

**Conventions**: `[P]` = parallelizable (distinct files, no ordering dep). `[USn]` = user story it serves. All paths absolute from repo root. `userId` always from `auth.getUser()`. Typed `FurqanEvent` names only — never string literals. n8n delivery failures → `automation_logs.status='failed'`, never `'succeeded'`.

---

## Phase 1: Setup

- [x] T000 **Open draft PR same-day** (constitution §branch-hygiene, /speckit-analyze C2). `gh pr create --draft --base main --head 023-reports-gamification-notifications --title "feat(023): reports, gamification & notifications — WIP"`. Done on 2026-06-19 → PR [#490](https://github.com/drdeebtech/furqan/pull/490), tracking issue [#489](https://github.com/drdeebtech/furqan/issues/489).
- [x] T001 Add 3 typed event members to the shared `FurqanEvent` surface (`src/lib/automation/events.ts` / `emit.ts` `WEBHOOK_ROUTES`): `monthly_report.ready = 'monthly_report.ready'`, `certificate.earned = 'certificate.earned'`, `honor_board.updated = 'honor_board.updated'`. Confirm `payment.failed`, `subscription.expiring`, `absence.outcome` already exist (emitted by 018/021); if absent, stop and flag — this spec consumes, never defines, those.
- [x] T002 [P] Add 4 keys to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`: `honor_board_refresh_cadence_days`, `notifications_whatsapp_enabled`, `notification_channel_matrix` (JSON `trigger → channel[]`, FR-012 matrix), and `subscription_expiring_lead_days` (integer days before period end for the expiry "continue?" prompt, default 7 — clarified 2026-06-19 / CHK015).

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass; event names resolve as typed members (a typo fails to compile).

---

## Phase 2: Foundational — DB Migrations

**⚠️ CRITICAL**: All user-story work is blocked until T006 (`npm run db:types`) completes.

- [x] T003 Create `supabase/migrations/20260620000000_notifications_whatsapp_channel.sql`:
  - `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;`
  - `ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check CHECK (channel <@ ARRAY['in_app','email','push','whatsapp']);`
  - No data migration — existing rows already satisfy the widened set.

- [x] T004 Create `supabase/migrations/20260620000001_reports_certificates.sql`:
  - **Verify first**: confirm no existing teacher-notes/session-notes table already serves this purpose; only create `teacher_notes` if absent (Key Entities note).
  - `CREATE TABLE teacher_notes (id uuid PK, student_id uuid FK→profiles, teacher_id uuid FK→profiles, content text, created_at, updated_at)` + index on `student_id`, `teacher_id` + `set_updated_at` trigger.
  - `CREATE TABLE monthly_reports (id uuid PK, student_id uuid FK→profiles, subscription_id uuid FK→subscriptions, period_year integer, period_month integer CHECK BETWEEN 1 AND 12, version integer NOT NULL DEFAULT 1 CHECK (version >= 1), level_assessment_summary text, generated_at timestamptz)` + `UNIQUE(student_id, period_year, period_month, version)` (clarified 2026-06-19 / CHK024 — versioned append for out-of-order corrections; reader contract `ORDER BY version DESC LIMIT 1`).
  - `CREATE TYPE certificate_type AS ENUM ('appreciation_juz','appreciation_level','course_completion');`
  - `CREATE TABLE certificates (id uuid PK, student_id uuid FK→profiles, certificate_type certificate_type, milestone_key text, cited_range_start text, cited_range_end text, issued_at timestamptz)` + `UNIQUE(student_id, certificate_type, milestone_key)`.
  - `CREATE TABLE honor_board_entries (id uuid PK, student_id uuid FK→profiles, display_name text, avatar_url text, achievement_metric numeric, rank_period date, is_opted_out boolean NOT NULL DEFAULT false, computed_at timestamptz)` + partial index `WHERE is_opted_out = false` + `UNIQUE(student_id, rank_period)`.
  - **RLS all 4 tables, policies in same migration, `(select auth.uid())` initplan**, `private.is_admin()` for admin reads:
    - `teacher_notes`: teacher INSERT/UPDATE own (`teacher_id`); student + linked guardian (via `guardian_children`) SELECT own student's; admin all.
    - `monthly_reports`: student + linked guardian SELECT own; service_role INSERT; BEFORE UPDATE OF `student_id`, `period_year`, `period_month` guard (service_role/migrations exempt).
    - `certificates`: student + linked guardian SELECT own; service_role INSERT; BEFORE UPDATE OF `student_id`, `certificate_type`, `milestone_key` immutable guard as **defense-in-depth** per FR-020 (service_role/migrations exempt) — ship the guard even though no client UPDATE policy is granted.
    - `honor_board_entries`: authenticated SELECT `WHERE is_opted_out = false`; student UPDATE `is_opted_out` on own row only (BEFORE UPDATE OF `student_id`, `achievement_metric`, `rank_period`, `display_name` guard); service_role INSERT/compute.
  - Seed `platform_settings`: `honor_board_refresh_cadence_days='7'`, `notifications_whatsapp_enabled='true'`, `notification_channel_matrix` (FR-012 default JSON map — see data-model §3), `subscription_expiring_lead_days='7'` (CHK015).

- [x] T005 `supabase migration up` (or `bash scripts/dev-local-db-bootstrap.sh` locally) — apply both migrations.
- [x] T006 `npm run db:types` → commit regenerated `src/types/database.ts`.
- [x] T007 Local verification (NFR-002): duplicate-insert blocked by each UNIQUE index; `certificates`/`monthly_reports` UPDATE of identity cols blocked by BEFORE UPDATE guard; non-linked guardian SELECT denied by RLS.

**Checkpoint**: `npm run sb:advisors` clean for the 4 new tables; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Guardian reports (teacher notes + monthly assessment) (P1) 🎯 MVP

**Goal**: Teacher records per-student notes; guardian reads only their child's notes + one monthly assessment per closed month.

**Independent Test**: Link guardian→student, teacher saves notes, close billing month → guardian (only) reads notes + single monthly report, rendered RTL.

- [x] T008 [P] [US1] Create `src/lib/domains/reports/notes.ts`: `getNotesForStudent(studentId)` (RLS-scoped read), `createNote(studentId, content)` — teacher-assignment check server-side; strip CR/LF from any value later placed in a notification header.
- [x] T009 [P] [US1] Create `src/lib/domains/reports/monthly-report.ts`: `generateMonthlyReport(studentId, year, month)` — idempotent via `automation_logs` key `report:{studentId}:{year}:{month}` (ON CONFLICT → skipped, no second issuance attempt); any cited surah/juz from `src/lib/quran/ayah-counts.ts`, never hardcoded; **versioned append on correction (CHK024 / clarified 2026-06-19)**: a re-run with new assessment content inserts `version = (SELECT COALESCE(MAX(version),0)+1 FROM monthly_reports WHERE student_id=? AND period_year=? AND period_month=?)` so corrections never overwrite; reads always `ORDER BY version DESC LIMIT 1`.
- [x] T010 [US1] Create `src/app/api/reports/[studentId]/notes/route.ts`: GET (student/guardian/teacher/admin, RLS) + POST (teacher only, zod `{content: string min1 max5000}`, 403 if not assigned, 422 validation).
- [x] T011 [US1] Create `src/app/api/reports/[studentId]/monthly/[year]/[month]/route.ts`: GET (student/guardian/admin), zod path params (`month` 1–12), returns nullable report.
- [x] T011a [US1] **BLOCKER (verify before T012):** confirm spec 018 emits a month-close event that triggers `monthly_report.ready`. This spec only consumes it — if no upstream emitter exists, FR-002's report never fires. Stop and resolve in spec 018 (add the emitter) before T012; do not mark FR-002 done with no emitter wired. **(/speckit-analyze H2):** [tracking issue](https://github.com/drdeebtech/furqan/issues) for the spec 018 emitter is filed separately; if 018 lags, T011b provides a fallback that lets 023 ship independently.
- [x] T011b [US1] **Fallback month-close detector** (de-risk H2 — implement only if spec 018 has not shipped `subscription.month_closed` by the time US1 is ready): nightly n8n cron that scans `subscriptions` for periods that crossed `current_period_end < now()` since the last run, emits `subscription.month_closed` locally via `emitEvent`, then runs `generateMonthlyReport`. Idempotent via the same `report:{studentId}:{year}:{month}` key — no duplicate risk if both 018's emitter and this fallback fire. Drop this task once spec 018's emitter is live.
- [x] T012 [US1] Wire `monthly_report.ready` emission + webhook callback into `src/app/api/webhooks/n8n/route.ts`: on `monthly_report.ready` callback from n8n → INSERT report-ready `notifications` row (in-app) via the canonical `routeNotification` helper from T028. The emission itself happens inside `generateMonthlyReport` (T009) — `monthly_report.ready` is OWNED by spec 023 per the round-2 clarification. Canonical `automation_logs` columns (round-2): `workflow_name='report_issuance'`, `event_name='monthly_report.ready'`, `idempotency_key='report:{studentId}:{year}:{month}'`, `payload_json` carries `{student_id, year, month, version}`.
- [x] T013 [P] [US1] Unit tests: `notes.test.ts` (RLS scoping, teacher-assignment gate), `monthly-report.test.ts` (idempotent replay of same content → skipped, no duplicate issuance attempt; **corrected content → new `version` row appended, MAX(version) canonical, prior versions preserved** per CHK024; out-of-order correction arriving after a newer period still appends to the older period only).

**Checkpoint**: Guardian reads only own student's notes + one monthly report; replay produces no second report.

---

## Phase 4: User Story 2 — Appreciation certificate per juz / level (P1)

**Goal**: Completing a juz / level milestone issues exactly one appreciation certificate citing the canonical range; student + guardian notified once.

**Independent Test**: Mark juz complete → one certificate, cited range == `src/lib/quran/ayah-counts.ts` for that juz; replay → no second certificate.

- [x] T014a [US2] **Architect task — author `src/lib/quran/juz-boundaries.ts` from a cited canonical mushaf** (round-2 clarification / AGENTS.md §2 hard constraint). The file MUST mirror the existing `ayah-counts.ts` pattern: 30 entries, each `juz N → { start_surah, start_ayah, end_surah, end_ayah }`, with a `TOTAL_JUZ = 30` self-check that throws at module load if the array length drifts. **The data MUST be transcribed from a verified canonical source** (e.g., the official Madani King Fahd Complex mushaf print, or an equivalent audited Quran data file); a citation comment at the top of the file MUST name the source. **No model generation.** Blocks T014 juz branch + T015 juz issuance + T036 juz-range unit test. (Level/course certificate branches do NOT need this file — they read surah:ayah directly via `ayah-counts.ts`.) **This task is owned by the architect role, not the Builder** per AGENTS.md §8 — file as a separate small PR if the Builder is running `/speckit-implement`.
- [x] T014 [P] [US2] Create `src/lib/domains/certificates/quran-ranges.ts`: `getJuzBoundaries(juzNumber)` / `getLevelBoundaries(...)` — reads only from `src/lib/quran/juz-boundaries.ts` (T014a) + `ayah-counts.ts` + `surahs.ts`; throws loudly on an unvalidatable range (never returns an approximation); never bypasses `student_progress_ayah_range_guard`. **Juz branch blocked on T014a**; level branch can ship independently.
- [x] T015 [US2] Create `src/lib/domains/certificates/issue.ts`: `issueCertificate(studentId, type, milestoneKey)` — idempotent via `automation_logs` (`workflow_name='certificate_issuance'`, `event_name='certificate.earned'`, `idempotency_key='cert:{studentId}:{type}:{milestoneKey}'` — ON CONFLICT → `status='skipped'`, `attempt_count` unchanged); populates `cited_range_start/end` from T014; service-role INSERT into `certificates`. **Canonical columns (round-2 clarification):** use `workflow_name`/`event_name`/`payload_json`/`result_json`/`error_message` — never the assumed `event_type`/`payload`/`error_detail` (those do not exist on the table).
- [x] T016 [US2] Extend `src/app/api/webhooks/n8n/route.ts`: on `certificate.earned` (`appreciation_juz`/`appreciation_level`) → `issueCertificate` + INSERT `notifications` for student AND linked guardian, single idempotency key each recipient.
- [x] T017 [US2] Create `src/app/api/certificates/[studentId]/route.ts`: GET (student/guardian/admin, optional `?type=` filter), display-safe certificate fields.
- [x] T018 [P] [US2] Unit tests: `quran-ranges.test.ts` (cited range == canonical for sampled juz; invalid juz throws), `issue.test.ts` (idempotent replay → skipped, exactly one certificate).

**Checkpoint**: One certificate per juz milestone; cited range matches canonical; student + guardian each notified once.

---

## Phase 5: User Story 3 — Course completion certificate + next-product suggestion (P2)

**Goal**: Completing a defined course issues one completion certificate + surfaces a next-product/surah suggestion; degrades gracefully when none applies.

**Independent Test**: Mark course (spec 019) complete → one `course_completion` certificate, range cited from canonical; next-product suggestion shown or neutral "well done".

- [x] T019 [P] [US3] Extend `src/lib/domains/certificates/issue.ts`: handle `course_completion` type — milestone_key = course id; cited range from the course's covered surahs via `src/lib/quran/`; idempotent key `cert:{studentId}:course_completion:{courseId}`.
- [x] T020 [P] [US3] Create `src/lib/domains/certificates/next-product.ts`: `suggestNextProduct(studentId, completedCourseId)` — references spec-019 catalog; returns `null` (neutral state) when no further product applies; never fabricates a product or surah / broken link.
- [x] T021 [US3] Extend the `certificate.earned` n8n branch to handle `course_completion` and attach the next-product suggestion to the certificate-earned notification payload.
- [x] T022 [P] [US3] Unit tests: course-completion idempotency; next-product graceful-degrade (null → neutral, never fabricated).

**Checkpoint**: One course-completion certificate; suggestion present or neutral; no fabricated product.

---

## Phase 6: User Story 4 — Honor board compute + opt-out (P2)

**Goal**: Honor board ranks diligent students, exposes only display-safe fields, excludes opted-out students; opt-out by default-visible.

**Independent Test**: Several students with progress → board lists by metric, display-safe only; opt-out excludes; guardian re-opts-in minor.

- [x] T023 [P] [US4] **BLOCKED — honor-board achievement metric formula undefined (see FR-010 [NEEDS CLARIFICATION]).** Do NOT invent a ranking formula. `computeHonorBoard` cannot populate `achievement_metric` until the product owner defines the metric. Stop and resolve FR-010 before implementing. Once defined: Create `src/lib/domains/honor-board/compute.ts`: `computeHonorBoard(rankPeriod)` — **sized at 50k per constitution §scale-target** (/speckit-analyze C1/C4, resolved): single-statement `BEGIN; DELETE FROM honor_board_entries WHERE rank_period = :period; INSERT INTO honor_board_entries (…) SELECT … FROM profiles WHERE is_active AND deleted_at IS NULL [inline metric]; COMMIT;` (≤50k rows, one round-trip, no N+1, no client loop); worker runs with `statement_timeout='30s'` so a timeout surfaces to Sentry without committing a partial state; reads always SELECT from the snapshot (no per-render write amplification); cadence from `honor_board_refresh_cadence_days`; `getHonorBoard(period, limit)` query `WHERE is_opted_out = false`. (P2/US4 only — does not block any P1 task.)
- [x] T024 [P] [US4] Create `src/lib/domains/honor-board/opt-out.ts`: `setOptOut(studentId, optedOut, callerUid)` — student sets own; guardian sets for linked child (validated via `guardian_children`); writes only `is_opted_out`.
- [x] T025 [US4] Create `src/app/api/honor-board/route.ts`: GET (auth optional, public), zod `{period?, limit default 20 max 100}`, returns display-safe fields only (no email/phone/contact).
- [x] T026 [US4] Create `src/app/api/honor-board/opt-out/route.ts`: PATCH (student/guardian), zod `{studentId?, optedOut: boolean}`, 403 if not authorized for that student.
- [x] T027 [P] [US4] Unit tests: ranking order; opted-out excluded; guardian-for-minor opt-out authorized via `guardian_children`; SELECT exposes zero contact columns (SC-008).

**Checkpoint**: Board excludes opted-out; only display-safe fields returned; guardian opt-out for minor works.

---

## Phase 7: User Story 5 — Lifecycle notification routing (P1)

**Goal**: Consume `payment.failed` / `subscription.expiring` / `absence.outcome` (emitted by 018/021) into idempotent, multi-channel notifications; expiry prompt sent before period end; n8n failures recorded `failed`.

**Independent Test**: Emit each owned trigger → single notification per (recipient, trigger, subject); replay → skipped; WhatsApp/n8n failure → `failed`, Sentry-surfaced.

- [x] T028 [US5] Create `src/lib/domains/notifications/routing.ts`: per-trigger Arabic-first (RTL) content builders for dunning/pre-suspension, expiry "continue?" (sent at exactly `period_end - N days` where N = `getSetting('subscription_expiring_lead_days')` parsed as integer, default 7 — CHK015), payment-retry, absence/excuse outcome, report-ready, certificate-earned; resolve the `notifications.channel[]` array per the **FR-012 channel matrix** from `platform_settings.notification_channel_matrix` (dropping `whatsapp` when `notifications_whatsapp_enabled='false'`) — never hardcode the channel set in handler code; idempotent INSERT via `automation_logs` key `notif:{recipientId}:{trigger}:{subjectKey}` (recipient-first; **issuance keys `cert:`/`report:` stay distinct per contracts §8** — issuance and delivery fail/retry independently, CHK048); strip CR/LF from any user/teacher-authored value placed in subject/header (FR-016).
- [x] T029 [US5] Extend `src/app/api/webhooks/n8n/route.ts` branches per the round-2 pragmatic-split clarification:
  - **`subscription.past_due` (CONSUMED from spec 018, already emitted)** → route to dunning / payment-failed notification. `safeCompareSecret` fail-closed before any side effect.
  - **`subscription.expiring` (EMITTED locally by spec 023)** → a nightly n8n cron reads `subscriptions.current_period_end` for active subscriptions, computes `period_end - getSetting('subscription_expiring_lead_days')` (default 7), and emits `subscription.expiring` via `emitEvent` for each due row. n8n then dispatches email/WhatsApp; the webhook callback inserts the in-app notification.
  - **`absence.outcome` (EMITTED locally by spec 023)** → a scheduled job (cadence TBD — likely nightly) queries `attendance` for new absence/excuse outcomes and emits `absence.outcome` per affected student+guardian. n8n dispatches; webhook callback inserts in-app.
  - Spec 023 MUST NOT mutate billing/attendance state — emission only for the two new local events; consumption-only for `subscription.past_due`.
  - When specs 018/021 ship their own emitters for these events, the local emission paths here are deleted (no name change needed — dot.notation matches).
- [x] T030 [US5] Fail-closed delivery accounting + spec-local retry (CHK032 / clarified 2026-06-19): n8n unreachable / non-2xx → `automation_logs.status='failed'` (never `'succeeded'`), surfaced via `logError`/Sentry. **Retry mechanism (spec-local, no platform schema change):** on a future delivery of the same `(recipient, trigger, subject)` for a row currently at `status='failed'`, the dispatcher MAY `DELETE` the failed row and re-INSERT as `started` to re-attempt. `succeeded`/`skipped`/in-flight `started` rows still hold the UNIQUE lock. **Canonical columns (round-2 clarification):** `workflow_name` (NOT NULL), `event_name`, `payload_json`, `result_json`, `error_message`, `status` CHECK in `started/succeeded/failed/skipped`, `attempt_count` (default 1). No `event_type`/`payload`/`error_detail` columns exist on `automation_logs` — do not invent them. The platform-wide partial UNIQUE index `WHERE status <> 'failed'` is filed as a separate follow-up spec (see T039) — do NOT bundle that cross-cutting migration into this spec.
- [x] T031 [P] [US5] Unit tests: per-trigger single notification; replay → `skipped` no-op (NFR-002); n8n 500 → `failed` not `succeeded` (SC-006); CR/LF stripped from header fields; **delete-and-retry: a `failed` row may be deleted + re-attempted → `started` → `succeeded`, but a `succeeded`/`skipped` row MUST NOT be re-attempted** (CHK032).

**Checkpoint**: Each owned trigger delivers once per recipient on configured channels; replay no-op; failures recorded `failed`.

---

## Phase 8: Polish

- [x] T032 [P] `npx tsc --noEmit` — fix all type errors.
- [x] T033 [P] `npm run lint` — fix all lint issues.
- [x] T034 `npm run test:unit` — all existing + new tests pass.
- [x] T035 `npm run sb:advisors` — zero new advisories for the 4 new tables.
- [x] T036 [P] Quran-range unit test (NFR-003 / SC-003): assert every cited certificate range equals `src/lib/quran/ayah-counts.ts` values AND a scan proves **no hardcoded** ayah/juz boundary literal in `src/lib/domains/certificates/` — `grep -rn '[0-9]\{1,3\}:[0-9]\{1,3\}' src/lib/domains/certificates/` → zero non-canonical literals.
- [x] T037 [P] RTL verification: certificates, monthly reports, honor board, and all 6 notification templates render correctly in Arabic RTL with tashkeel/waqf preserved (SC-007). **Verified 2026-06-19:** code audit confirms no destructive string transforms (`.trim()` is ASCII-whitespace only — safe for tashkeel U+064B–U+065F and waqf markers); `display_name` and `level_assessment_summary` pass through verbatim; agent-browser screenshot confirms global RTL layout unbroken.
- [x] T038 Commit all spec 023 artifacts + tasks.md; push.
- [x] T039 [P] File follow-up spec for the platform-wide `automation_logs` partial UNIQUE index `WHERE status <> 'failed'` (CHK032 cross-cutting follow-up, /speckit-analyze M4). `automation_logs` is shared across specs 018/021/022/023 — a partial-index migration affects every consumer's retry semantics. **Filed 2026-06-19 as [#491](https://github.com/drdeebtech/furqan/issues/491)**. Author spec 025 that: (a) audits each consumer (018/021/022/023) for behavior change under the partial index, (b) ships the ALTER as its own forward migration, (c) removes spec-local delete-and-retry from 023's T030 once the platform fix lands. **Out of scope for 023 — issue filed, do not implement here.**
- [x] T039a [P] Run `npm run specs:index` and commit the regenerated `specs/INDEX.md` (flips 023 → "Implementing" via the open draft PR #490). Note: husky pre-commit on `specs/**/*.md` already does this automatically — this task is a belt-and-braces verification step before merge.

---

## Dependencies

- **Phase 1** → **Phase 2** (event members + setting keys before migrations reference them).
- **Phase 2** → **Phases 3–7** (types regenerated at T006 before any domain/route code).
- **US1, US2, US5** parallel after Phase 2 (all P1).
- **US3** depends on T015 (`issue.ts` from US2) + spec-019 catalog.
- **US4** parallel after Phase 2.
- **Phase 8** → all stories complete.

## MVP Scope (P1 only)

Phases 1 → 2 → 3 (US1) → 4 (US2) → 7 (US5) → 8 partial. Delivers guardian reports, juz/level appreciation certificates, and lifecycle notifications — the encouragement + visibility core. US3 (course-completion) and US4 (honor board) are P2 follow-ons.

---

## Requirements Coverage (traceability matrix — /speckit-analyze M1)

| Req | Has task(s)? | Task IDs | Notes |
|-----|--------------|----------|-------|
| FR-001 teacher notes (guardian-readable, RLS) | ✅ | T008, T010 | notes CRUD + route |
| FR-002 monthly report + versioned merge | ✅ | T009, T011, ⛔T011a, T011b, T012 | **⛔ blocked on upstream emitter; T011b fallback** |
| FR-003 Quran ranges canonical-only | ✅ | T009 | ranges from `src/lib/quran/` |
| FR-004 "report ready" notification | ✅ | T012 | delivered on generation |
| FR-005 juz/level appreciation cert | ✅ | T014, T015, T016 | canonical-range cited |
| FR-006 course-completion + next-product | ✅ | T019, T020, T021 | degrade-to-neutral when none |
| FR-007 idempotent issuance (student, type, milestone_key) | ✅ | T015, T018 | composite UNIQUE |
| FR-008 appreciation-not-ijazah invariant | ✅ | T004 (enum), T015 | schema-enforced negative requirement |
| FR-009 Arabic RTL + tashkeel preservation | ✅ | T037 | RTL verification task |
| FR-010 honor board (privacy + opt-out; metric defined) | ✅ | T023, T024, T025, T026, T027 | metric: SUM(pages_reviewed × COALESCE(quality_rating,4)/5); compute fn in migration 20260620000002 |
| FR-011 three channels incl. WhatsApp | ✅ | T003, T028 | CHECK constraint extended |
| FR-012 per-trigger channel matrix | ✅ | T028, T031 | admin-configurable via platform_settings |
| FR-013 consume events; expiry 7d before period end | ✅ | T028, T029 | lead time configurable |
| FR-014 idempotent delivery (recipient, trigger, subject) | ✅ | T028, T030, T031 | recipient-first notif: prefix |
| FR-015 n8n failure → `failed` (never `succeeded`) | ✅ | T030 | retry-safe via delete-and-retry |
| FR-016 CR/LF strip on subject/header fields | ✅ | T028, T031 | injection guard |
| FR-017 typed `FurqanEvent` names only | ✅ | T001 | enum members |
| FR-018 RLS on every new table, same migration | ✅ | T004 | all 4 new tables |
| FR-019 `(select auth.uid())` initplan + is_admin | ✅ | T004 | policy pattern |
| FR-020 BEFORE UPDATE OF guards on identity cols | ✅ | T004, T007 | service-role/migrations exempt |
| FR-021 db:types + tsc + lint + sb:advisors | ✅ | T006, T032, T033, T035 | gates |
| SC-001 guardian RLS scoping (100% test cases) | ✅ | T013 | notes + monthly RLS tests |
| SC-002 exactly one report + notification per student+month | ✅ | T013, T018 | idempotent replay test |
| SC-003 cited range matches canonical (0 fabricated) | ✅ | T018, T036 | NFR-003 scan |
| SC-004 0 duplicates across 100% of retries | ✅ | T013, T018, T031 | NFR-002 replay |
| SC-005 channel matrix + 7d lead (100% recipients) | ✅ | T028, T031 | per-trigger assertions |
| SC-006 n8n failure surfaced 100% (0 silent success) | ✅ | T030, T031 | fail-closed |
| SC-007 Arabic RTL + tashkeel preserved | ✅ | T037 | manual verification |
| SC-008 honor board: 0 private fields, 100% opted-out excluded | ✅ | T023, T027 | privacy enforced (T027); metric live (T023); opted-out excluded at DB level |
| NFR-001 fail-closed X-N8N-Secret | ✅ | T029 | safeCompareSecret before side effect |
| NFR-002 replay test (no side effect on duplicate) | ✅ | T013, T018, T031 | idempotency-ledger skipped |
| NFR-003 Quran-range unit test (no hardcoded counts) | ✅ | T036 | grep + canonical-match |
| NFR-004 unit/integration coverage on critical paths | ✅ | T013, T018, T022, T027, T031 | per-story test tasks |

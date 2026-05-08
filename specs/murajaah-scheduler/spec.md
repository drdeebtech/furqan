# Feature Specification: Murajaah Scheduler (مراجعة)

**Feature Branch**: `feat/murajaah-scheduler` (pending — created when `/speckit.specify` re-runs against this draft)
**Created**: 2026-05-08
**Status**: Draft (worked example for spec-kit activation; ready for `/speckit.clarify`)
**Input**: User description: "Convert flat student_progress history into a daily review prompt that respects spaced-repetition principles, surface the prompt on the student dashboard, and let teachers see what their students are due to revise."

> This file is the canonical "what does a FURQAN spec look like" reference. It was authored by hand against `.specify/templates/spec-template.md` to prove the spec-kit loop works at the repo root after the brownfield activation. When the operator decides to actually build Murajaah, the next step is `/speckit.clarify` against this file.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Student opens dashboard and sees today's review batch (Priority: P1)

A student logs in. On the dashboard, above their upcoming sessions, a "مراجعة اليوم" card lists 5–15 ayah ranges they previously memorised that the system has scored as due for review today. Each row shows: surah + ayah range, the date they last revised, and a "بدأت المراجعة" / "أنهيت المراجعة" pair of buttons.

**Why this priority**: Without daily prompting, students forget memorised material. Today's `student_progress` table records *what was memorised* but never surfaces *what is due*. This story unblocks the entire feature; the teacher and admin views are useless without it.

**Independent Test**: Seed a student with 50 historical `student_progress` rows of varying ages; load `/student/dashboard`; confirm the card shows 5–15 rows ordered by computed-staleness; confirm the buttons enqueue a review-completed entry.

**Acceptance Scenarios**:

1. **Given** a student with 50 `student_progress` rows spanning 6 months, **When** they load the dashboard, **Then** the Murajaah card shows 5–15 rows whose computed next-review-date is ≤ today.
2. **Given** the Murajaah card is empty (nothing due), **When** the student loads the dashboard, **Then** the card hides itself rather than showing an empty placeholder.
3. **Given** the student clicks "أنهيت المراجعة" on a row, **When** the action returns, **Then** that row vanishes from today's batch and the next-review-date shifts forward per the SM-2 algorithm.
4. **Given** the action throws (DB error), **When** the student clicks the button, **Then** the row stays visible and an `<ActionFeedback>` red banner shows the error (per Constitution Principle II).

---

### User Story 2 — Teacher sees a student's next-review queue (Priority: P2)

A teacher opens a student's profile. A "مراجعة قادمة" panel shows the next 30 days of review batches grouped by date, so the teacher can plan upcoming sessions around the queue (e.g., "next Tuesday this student has 8 reviews due — let's tackle those in person").

**Why this priority**: Teachers steer the student's learning path. Without visibility into the upcoming queue, they can't plan; they only see retroactively what was reviewed. P2 because student value (P1) ships first; teacher visibility is a leverage feature, not a blocker.

**Independent Test**: Open `/teacher/students/[uuid]` for a student with seeded history; verify the panel shows 30 days of upcoming reviews, ordered by date, grouped by surah.

**Acceptance Scenarios**:

1. **Given** a student with active progress, **When** the teacher opens the student profile, **Then** the panel shows the next 30 days of due reviews.
2. **Given** the teacher has the eval-discipline gate failing (per ADR-0004 §"Out of scope"), **When** they try to mark a review on the student's behalf, **Then** they get a Forbidden error (Constitution Principle IV).

---

### User Story 3 — Admin tunes the SM-2 parameters (Priority: P3)

An admin opens `/admin/settings`. A new "إعدادات المراجعة" section exposes the SM-2 algorithm's three constants (initial interval, easiness factor, lapse penalty) as numeric fields. Changes apply immediately; no redeploy.

**Why this priority**: Once Murajaah ships, the operator will want to A/B the SM-2 curve against student behaviour. P3 because the feature works with sensible defaults (interval=1d, EF=2.5, lapse=0.8); tuning is an iteration after launch.

**Independent Test**: Change "initial interval" from 1 to 3, observe a freshly-completed review schedule its next due-date 3 days out instead of 1. Audit log records the change with the admin's user_id.

**Acceptance Scenarios**:

1. **Given** an admin updates the easiness factor, **When** the next review is scheduled, **Then** the new factor is used.
2. **Given** the admin enters an invalid value (negative, zero, > 10), **When** they submit, **Then** the form returns a red banner; no DB write occurs.

---

### Edge Cases

- **A student has zero `student_progress` rows.** Dashboard card hides. Teacher panel shows "لا توجد مراجعات مجدولة".
- **All progress rows pre-date the SM-2 default.** The first daily batch will be huge (every memorised ayah is "overdue"). The query MUST cap to 15 rows per day; the rest stay queued for tomorrow's batch.
- **Student marks a review complete twice in quick succession.** Idempotency on the server action — the second click is a no-op if the row's `last_reviewed_at` is within 1 minute of now.
- **Notification ran (per FR-005) but the student didn't open the app.** Tomorrow's batch absorbs today's overdue items; no double-notification is sent for the same item.
- **A scheduled push fails (Communication outage).** The DB write that says "review scheduled" still committed; the notification retry is owned by `/api/cron/n8n-healthcheck` per Constitution Principle III.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST compute, for each student, a derived "next-review-date" per `student_progress` row using the SM-2 algorithm (initial interval, easiness factor, lapse penalty).
- **FR-002**: System MUST expose today's review batch (≤ 15 rows) to the student via the dashboard.
- **FR-003**: System MUST expose the next 30 days of upcoming reviews to the student's teacher.
- **FR-004**: Students MUST be able to mark a review complete; the action MUST recompute the row's next-review-date.
- **FR-005**: System MUST send a notification (in-app + dispatcher channel preferences per `communication_preferences`) when a student has ≥ 3 due reviews and hasn't opened the app today. Per Principle III this notification is best-effort post-commit.
- **FR-006**: Admins MUST be able to tune the SM-2 constants in `/admin/settings`; changes MUST be audit-logged.
- **FR-007**: The "mark review complete" server action MUST be wrapped in `loudAction` and the consuming form MUST render `<ActionFeedback>` (Constitution Principle II).
- **FR-008**: The compute step (FR-001) MUST run inside a Postgres function (per Principle III) since it touches `student_progress` and a new `student_review_schedule` table atomically.
- **FR-009**: Route adapters call `requireRole(...)` per Principle IV. Domain functions in `src/lib/domains/progress/orchestrate.ts` (or wherever the orchestrator lands per `/speckit.plan`) accept already-authenticated structured input.
- **FR-010**: [NEEDS CLARIFICATION: should the SM-2 algorithm version be stored alongside each schedule row so historical data survives algorithm changes? Yes/No.]
- **FR-011**: [NEEDS CLARIFICATION: when a student misses many days, should the next batch include all overdue items capped at 15, or only "fresh" overdue (≤ 7 days late)?]

### Key Entities

- **student_review_schedule** — one row per `(student_id, progress_id)` storing `next_review_at`, `easiness_factor`, `lapse_count`, `last_reviewed_at`, `algorithm_version`. Owned by the **Progress** domain (per CONTEXT.md "Domains").
- **student_progress** — existing table; the source-of-truth for *what was memorised*. Murajaah reads it; never writes to it.
- **murajaah_settings** — three rows in `platform_settings` (per the existing pattern): `sm2_initial_interval_days`, `sm2_easiness_factor`, `sm2_lapse_penalty`.
- **notifications** — existing; Murajaah dispatches via `notify(opts)` per Principle II's best-effort post-commit rule.

### Domains touched

Per CONTEXT.md "Domains":
- **Progress** (primary) — owns `student_review_schedule`; the SM-2 compute lives here.
- **Communication** (consumer) — receives a `notify({type:'murajaah.due'})` call; defines its own quiet-hours behaviour.
- **Session** (read-only) — the teacher panel reads the student's upcoming `sessions` so the queue can be cross-referenced with planned classes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 70% of active students who have ≥ 5 memorised ayahs see at least one Murajaah card per week within 14 days of launch.
- **SC-002**: P95 dashboard load time stays within +50ms of pre-launch baseline (the new query is one extra Postgres function call; budget is tight).
- **SC-003**: Of students who see the card and click "أنهيت المراجعة", 80% return within 7 days for the next batch.
- **SC-004**: Zero "review scheduled but no DB row" reports in `automation_logs` over the first month (Principle III atomicity holds).
- **SC-005**: Admin tuning of SM-2 constants takes effect on the next scheduled review without redeploy.

## Assumptions

- Existing `student_progress` rows accurately reflect what was memorised. (Audit shows this is mostly true; minor cleanup is out of scope for this spec.)
- The dispatcher's quiet-hours config in `communication_preferences` is the single source of truth for when Murajaah notifications can fire.
- The `/admin/settings` page already supports adding new sections (it does — see `platform_settings` integration).
- The SM-2 algorithm is acceptable as a v1; alternatives (FSRS, Leitner) are tracked separately if this proves underwhelming.
- No new role surface — students see the card, teachers see the panel, admin tunes the constants. Per Principle V this means **spec-kit is appropriate** (multi-PR scope, three role surfaces touched) but no new owner-domain.

## Out of scope (this spec)

- Cross-student leaderboards or "most consistent reviewer" gamification.
- Audio recording of reviews or AI-graded recitation accuracy during Murajaah (separate spec).
- Adaptive scheduling that uses session-evaluation scores as a quality signal — interesting but not v1.
- Migration of pre-launch `student_progress` rows into a backfilled schedule. The first batch will be computed lazily on first dashboard load.
- The `/admin/control-tower` widget for "students with ≥ 10 overdue reviews" — easy follow-up, but not v1.

## Cross-references

- `.specify/memory/constitution.md` — checked on `/speckit.plan` run.
- `CONTEXT.md` "Domains" — Progress + Communication + Session.
- `CLAUDE.md` "Domain Ownership Model", "No Silent Failures Policy", "Database Migrations Policy".
- ADR-0004 — atomic-critical-path-via-Postgres-function pattern; this spec adopts it for FR-008.
- `EVENT_CATALOG.md` — a new event `murajaah.due` will be added per the catalog's "Adding an event" procedure (separate one-line PR before `/speckit.tasks`).
- Obsidian: `Runs/2026-05-04-2313-deep-pedagogical-analysis-student-benefit.md` — original framing of why this matters.

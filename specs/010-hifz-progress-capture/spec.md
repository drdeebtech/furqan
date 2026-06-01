# Feature Specification: Ḥifẓ Progress Capture (تسجيل الحفظ)

**Feature Branch**: `010-hifz-progress-capture`
**Created**: 2026-06-01
**Status**: Draft (ready for `/speckit.clarify`)
**Input**: User description: "Record what a student memorized/reviewed each session as a validated sūrah:āyah range, feeding the (already-specced, not-yet-built) `001-murajaah-scheduler` SM-2 v1."

## Context — why this exists

A three-lens audit (engineering · Qurʾān-teaching · learner-retention) found that **ḥifẓ range tracking is scaffolded but unwired**:

- `student_progress` has `surah_from / ayah_from / surah_to / ayah_to` columns and read/display UI exists (teacher session page, student progress page, the murājaʿah windows).
- **No code path writes a range.** Across the entire `src` tree the only mutation of `student_progress` is one upsert in `src/app/teacher/sessions/[id]/actions.ts` (`markNoErrorsObserved`, `progress_type='muraja'`, no ranges). The single prod row carrying a range is seed data (1 row total).
- Therefore the SM-2 scheduler specced in **`001-murajaah-scheduler`** has **no data source** — it reads `progress_type='new'` rows that nothing creates.

This feature is the **upstream prerequisite** for `001`. It is greenfield capture (Principle V tracer-bullet), not a rewrite.

**Relationship to `001-murajaah-scheduler`**: `001` *reads* `student_progress` and computes review schedules. `010` *writes* `student_progress` with validated ranges. They share the table; `010` ships first.

## Clarifications

### Session 2026-06-01 (resolved with best-practice defaults)

- Q: Where do the canonical 114 āyah counts live (source of truth for validation)? → A: **A seeded Postgres reference table `quran_surahs(surah_num PK 1..114, name_ar, name_en, ayah_count)`** is the DB source of truth, plus a **TypeScript mirror `src/lib/quran/ayah-counts.ts`** for the action-layer fast check and UI dropdowns. The counts are the fixed Ḥafṣ/Madanī muṣḥaf values (Al-Fātiḥah 7 … An-Nās 6) and never change, so the mirror cannot drift in practice; a unit test asserts the TS mirror equals the seeded table. Rationale: a network round-trip per keystroke is unacceptable UX, yet the DB still needs an authoritative copy for the hard guard.
- Q: How is the "impossible range" guard enforced at the DB level (a CHECK can't reference another table)? → A: **A `BEFORE INSERT OR UPDATE` trigger on `student_progress`** validates `surah_from/ayah_from/surah_to/ayah_to` against `quran_surahs` and `RAISE`s on violation, so **every** writer is guarded, not just the happy-path action. Plus an in-table CHECK for the cheap invariants (`ayah_* >= 1`, the existing ordering check). Defense in depth: action layer (UX) → trigger (hard guard) → CHECK (cheap invariants).
- Q: The capture writes one `student_progress` row + N `recitation_errors` — atomic? → A: **Yes, via a `record_student_progress(...)` Postgres function** (Principle III). Progress-row upsert + error-rows insert commit together or not at all; the trigger validates inside the same transaction. The teacher never lands a progress row whose errors failed to write.
- Q: `recitation_errors.surah_num` is currently nullable (ambiguous). Make it required? → A: **Required for real errors, not for the "no errors observed" sentinel.** A CHECK allows `surah_num IS NULL` only when `note = '__no_errors_observed_sentinel__'`; all other rows MUST carry a `surah_num` validated against `quran_surahs`. No backfill needed beyond the (currently zero) real error rows.
- Q: Does this feature add Juzʾ / ḥizb / page modeling? → A: **No** — out of scope here (a later phase). `quran_surahs` MAY carry a `juz_start` column for future use but the capture form does not surface Juzʾ/page in v1.
- Q: Does this feature change the review methodology (SM-2 vs traditional sabaq/sabqī/manzil)? → A: **No.** `001` owns the methodology (SM-2). `010` only records what was memorized/reviewed. The `progress_type` vocabulary already maps to ḥifẓ practice: `new` = sabaq (today's new portion), `muraja` = sabqī/manzil (review of recent/old ḥifẓ), `correction` = tightening a previously-recorded portion.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Teacher records the session's ḥifẓ in seconds (Priority: P1)

After a session, on `/teacher/sessions/[id]`, the teacher fills a short "ماذا حفظ الطالب اليوم؟" capture: progress type (جديد / مراجعة / تصحيح), the sūrah:āyah range (from-sūrah + from-āyah → to-sūrah + to-āyah, sūrah via Arabic dropdown of the 114), an optional pages count, a 1–5 quality rating, and any recitation errors (āyah + error type). Submit writes one validated `student_progress` row (+ error rows), and downstream (parent report, SM-2 scheduler) is notified.

**Why this priority**: This is the entire feature. Without it, `student_progress` ranges stay empty, the student progress page shows nothing real, and `001`'s SM-2 scheduler has nothing to schedule. Everything else depends on it.

**Independent Test**: On a seeded completed booking, open the teacher session page, record `new` Al-Baqarah 1→5, submit; assert a `student_progress` row exists with `surah_from=2, ayah_from=1, surah_to=2, ayah_to=5, progress_type='new'`, and that `emitEvent("progress.recorded")` fired.

**Acceptance Scenarios**:

1. **Given** a completed booking with no progress row, **When** the teacher records a valid range and submits, **Then** one `student_progress` row is written and a success `<ActionFeedback>` banner shows.
2. **Given** the teacher enters Al-Fātiḥah (7 āyāt) āyah-to = **300**, **When** they submit, **Then** the action returns a red `<ActionFeedback>` Arabic error ("سورة الفاتحة تحتوي على 7 آيات فقط") and **no** DB row is written.
3. **Given** the booking already has a progress row, **When** the teacher re-records it, **Then** the existing row is updated (unique `(student_id, booking_id)` upsert), not duplicated.
4. **Given** the capture includes 2 recitation errors, **When** the action returns, **Then** the progress row **and** both error rows are present, or — on any failure — none of them are (atomic).
5. **Given** the DB write throws, **When** the teacher submits, **Then** the row stays unsaved and a red `<ActionFeedback>` error shows (Principle II — no silent failure).

### User Story 2 — Student sees their real memorization progress (Priority: P2)

A student opens `/student/progress`. Instead of empty/seed placeholders, they see their actual recorded ranges over time — what they memorized (sabaq), what they reviewed (murājaʿah), corrections — with sūrah names in Arabic and dates.

**Why this priority**: Student motivation, and it makes the captured data visible/auditable. P2 because the capture (P1) must exist first; the read UI largely exists and just needs real data.

**Independent Test**: Seed 5 progress rows for a student across 30 days; load `/student/progress`; assert rows render with correct Arabic sūrah names and ranges, newest first.

**Acceptance Scenarios**:

1. **Given** a student with recorded progress, **When** they open the progress page, **Then** their ranges render with Arabic sūrah names and dates.
2. **Given** a student with zero progress rows, **When** they open the page, **Then** a calm empty-state shows ("لم تُسجَّل مراجعات بعد") — never an error or a fabricated range.

### User Story 3 — Admin oversight & data integrity (Priority: P3)

An admin trusts that no Islamically-impossible range can exist in the data — the DB guard makes it unrepresentable, regardless of which code path or future tool writes.

**Why this priority**: Integrity guarantee for evaluations, parent reports, and the SM-2 scheduler that all consume this data. P3 because the guard ships with P1; this story is the explicit verification of it.

**Independent Test**: Attempt a direct SQL insert of An-Nās (6 āyāt) āyah 1→50 bypassing the app; assert the trigger raises and the row is rejected.

**Acceptance Scenarios**:

1. **Given** any writer (app, RPC, manual SQL, future bulk import), **When** an out-of-bounds range is written, **Then** the `BEFORE` trigger rejects it.
2. **Given** a recitation error is logged, **When** `surah_num` is NULL and the note is not the sentinel, **Then** the CHECK rejects it.

### Edge Cases

- **Single-āyah range** (`from = to`, same sūrah+āyah) — valid (memorized one āyah).
- **Cross-sūrah range** (e.g., An-Nabaʾ 1 → An-Nāziʿāt 5) — valid; the trigger validates `ayah_from ≤ count(surah_from)` and `ayah_to ≤ count(surah_to)`, with `surah_to ≥ surah_from` and the existing ordering check.
- **`progress_type='muraja'` with a wide range** (reviewed a whole Juzʾ-worth) — allowed; no upper span cap in v1 (teacher judgment).
- **No range recorded, only "no errors observed"** — the existing sentinel path (`markNoErrorsObserved`) stays valid; ranges are optional on a pure-review note, required when the teacher asserts a memorized portion (`progress_type='new'`).
- **Teacher edits a prior session's progress** — upsert on `(student_id, booking_id)` overwrites; an audit row records the change (academic-record integrity).
- **Sūrah from dropdown but free-typed āyah out of range** — caught at action layer first (fast Arabic error), trigger as backstop.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a teacher record, for a completed booking, a `student_progress` row with `progress_type ∈ {new, muraja, correction}`, `surah_from/ayah_from`, `surah_to/ayah_to`, optional `pages_reviewed`, `quality_rating ∈ 1..5`, and `level`.
- **FR-002 (NON-NEGOTIABLE — Islamic accuracy)**: The system MUST make Islamically-impossible ranges **unrepresentable**. `ayah_from`/`ayah_to` MUST be ≥ 1 and ≤ the canonical Ḥafṣ āyah count of their respective sūrah; `surah_to ≥ surah_from`; on a same-sūrah range `ayah_to ≥ ayah_from`. Enforced at the DB level by a `BEFORE INSERT OR UPDATE` trigger on `student_progress` reading `quran_surahs`, so the guarantee holds for **every** writer.
- **FR-003**: The canonical reference MUST exist as a seeded `quran_surahs(surah_num PK CHECK 1..114, name_ar, name_en, ayah_count CHECK > 0)` table (114 rows, Ḥafṣ/Madanī muṣḥaf), with a TypeScript mirror `src/lib/quran/ayah-counts.ts`; a unit test MUST assert the mirror equals the seeded data.
- **FR-004**: The capture server action MUST validate the range at the action layer and return a user-facing **Arabic** error naming the offending sūrah and its āyah count, before any DB write (UX layer of defense in depth).
- **FR-005 (Principle III — atomic)**: The progress-row write and any `recitation_errors` rows MUST commit atomically via a `record_student_progress(...)` Postgres function. Partial writes MUST be impossible.
- **FR-006**: `recitation_errors` rows MUST carry a `surah_num` (validated against `quran_surahs`) for all real errors; `surah_num` MAY be NULL only for the `__no_errors_observed_sentinel__` marker, enforced by a CHECK constraint.
- **FR-007 (Principle II — loud failures)**: The capture action MUST be wrapped in `loudAction` and the form MUST render `<ActionFeedback>`. No discarded errors, no caught-and-swallowed failures.
- **FR-008 (Principle IV — auth at the boundary)**: The route adapter MUST `requireRole("teacher")` and verify the teacher owns the session's booking before calling the domain function; the domain function receives already-authenticated structured input.
- **FR-009 (Principle I — domain ownership)**: Capture logic lives in the **Progress** domain (`src/lib/domains/progress/`); the route adapter is a thin boundary. `student_progress`, `recitation_errors`, `quran_surahs` belong to Progress.
- **FR-010**: On successful capture the system MUST `emitEvent("progress.recorded", "student_progress", <id>, {...})` (best-effort post-commit, Principle III) so downstream consumers (parent reports, the `001` SM-2 nightly compute) can react. A new `FurqanEvent` key is added to `WEBHOOK_ROUTES`.
- **FR-011**: A correction to a previously-recorded session MUST upsert on `(student_id, booking_id)` (no duplicate rows) and MUST write an `audit_log` row capturing the change (academic-record integrity).
- **FR-012**: The student progress read UI (`/student/progress`) MUST render real captured rows with Arabic sūrah names and a calm empty-state when none exist (no fabricated ranges).
- **FR-013 (migration discipline)**: All schema changes (the `quran_surahs` table + seed, the trigger, the `recitation_errors` CHECK, the `record_student_progress` function) ship as forward migrations via `./scripts/new-migration.sh`; CI `supabase db push` is the source of truth.

### Key Entities

- **student_progress** — existing. This feature is its first real **write** path. Source-of-truth for *what was memorized/reviewed* per `(student_id, booking_id)`. Read by `001`.
- **quran_surahs** *(new)* — canonical reference: `surah_num` (1..114), `name_ar`, `name_en`, `ayah_count`. Seeded once, immutable. Backs the FR-002 trigger and the UI dropdown.
- **recitation_errors** — existing. Gains the `surah_num`-required CHECK (FR-006). Error taxonomy (`makharij, sifat, madd, waqf, ghunna, other`) unchanged — correct tajwīd terminology.
- **ayah-counts mirror** — `src/lib/quran/ayah-counts.ts`, the TS copy of `quran_surahs.ayah_count` for action-layer + client validation.

### Domains touched

Per CONTEXT.md "Domains":
- **Progress** (primary, owner) — capture function, `quran_surahs`, validation.
- **Communication** (consumer) — parent reports already keyed off progress; unchanged beyond the new event.
- **Automation** (consumer) — receives `progress.recorded`; the `001` nightly compute listens.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly captured `student_progress` rows carry a sūrah:āyah range that passes canonical validation (impossible ranges are 0, enforced, not merely discouraged).
- **SC-002**: A teacher can capture a session's ḥifẓ in **≤ 20 seconds** / ≤ 5 form interactions (fast post-session UX — lens 3).
- **SC-003**: After launch, `001`'s SM-2 scheduler has a non-empty data source — the count of `progress_type='new'` rows with ranges grows with sessions (today: 0).
- **SC-004**: Zero Islamically-impossible ranges exist in `student_progress` at any time, verifiable by an audit query (`ayah_to > (SELECT ayah_count FROM quran_surahs WHERE surah_num = surah_to)` returns 0 rows).
- **SC-005**: At 50k DAU the capture path adds no fan-out write amplification — exactly one progress row (+ its error rows) per session, with one indexed `quran_surahs` PK lookup per validation.

## Assumptions

- **Scale**: capture is a per-session teacher action (low frequency relative to renders); validation is in-process + a PK lookup on a 114-row table. No per-render writes, no admin bulk fan-out. Sized for 50k per the Scale Target Rule.
- **Muṣḥaf standard**: Ḥafṣ ʿan ʿĀṣim, Madanī muṣḥaf āyah numbering (the platform default; `recitation_standard` on `student_progress` already records per-row qirāʾah where it differs). Warsh/other counts are out of scope for v1's reference; a non-Ḥafṣ count would be a future `quran_surahs` variant column.
- **`001` dependency direction**: `010` ships independently and first; `001` (SM-2) consumes its output later. No code dependency from `010` on `001`.
- **Existing read UI**: `/student/progress` and the teacher session page already render ranges; this feature supplies the data and the capture form, with minimal read-side change.
- **Spelling**: this spec uses *murājaʿah* in prose; the DB enum value remains `muraja` (no enum rename — that churn is tracked separately and is out of scope).

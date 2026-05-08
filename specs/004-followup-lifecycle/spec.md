# Feature Specification: Follow-up Lifecycle (دورة حياة المتابعة)

**Feature Branch**: `004-followup-lifecycle`
**Created**: 2026-05-08
**Status**: Brownfield documentation (the lifecycle is already in production; this spec captures observed behaviour)
**Input**: Formalize the prose state machine from `LIFECYCLES.md` §3 into spec-kit format so the follow-up domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`.

> **Brownfield framing.** The follow-up lifecycle (referred to as "homework" in the database identifiers — `homework_assignments`, `homework_status`, `createHomework`, etc. — but **always "follow-up" / "متابعة" in user-facing text** per the constitution's Bilingual UX rule and the explicit migration `20260505191211_update_help_center_homework_label_to_followup.sql`) has been in production since FURQAN's V10 build (Phase A homework system). This spec is *descriptive* — it captures what production currently does, not what it should do. Code identifiers stay as-is; user-facing prose uses "follow-up". Per Constitution Principle V (Tracer-Bullet Adoption), retrofitting an already-shipped feature into spec-kit format is permissible documentation work.

> **Naming reconciliation**: `LIFECYCLES.md` §3 collapses the four "graded" outcomes into a single "graded" state with branches. The actual `homework_status` ENUM has 6 values (`assigned | student_ready | completed_excellent | completed_good | completed_needs_work | completed_not_done`). This spec uses the 6-state reality.

## State machine (source of truth: `homework_assignments.status` enum)

```
                           ┌──────────┐
                           │ assigned │ ← Teacher creates after session via createHomework()
                           └────┬─────┘
                                │
                  Student clicks "I'm Ready" via markStudentReady()
                                │
                           ┌────▼─────────┐
                           │student_ready │
                           └────┬─────────┘
                                │
                  Teacher grades via gradeHomework(grade)
                                │
       ┌────────────────────────┼───────────────────────────────┐
       │                        │                               │
       ▼                        ▼                               ▼
┌──────────────────┐  ┌─────────────────┐   ┌──────────────────────────┐
│completed_excellent│  │completed_good   │   │completed_needs_work     │
└──────────────────┘  └─────────────────┘   │completed_not_done       │
   (terminal)            (terminal)         └──────────┬──────────────┘
                                                       │
                                            Auto-regenerate inline
                                            (new row, parent_assignment_id ← old.id)
                                                       │
                                                ┌──────▼─────┐
                                                │  assigned  │ (new cycle)
                                                └────────────┘
```

**Authoritative enforcement**: TS pre-checks inside the server actions. **Unlike booking's `validate_booking_status` SQL trigger, the follow-up domain has no DB-level state-machine backstop.** This is a deliberate-or-accidental architectural difference (see research.md Decision 2). All enforcement lives in `src/lib/actions/homework.ts`.

**Owner files**:
- `src/lib/actions/homework.ts` — `createHomework()`, `markStudentReady()`, `gradeHomework()`, `editHomework()`, `getHomeworkAudioUrl()`, `deleteHomework()`. All 6 server actions live in this single file.
- Storage: Supabase Storage bucket for audio submissions (added 2026-05-04 via `20260504210746_add_homework_audio_submission.sql`).
- Events to n8n: `homework.assigned`, `homework.student_ready`, `homework.graded` — emitted via `emitEvent(...)`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Teacher creates a follow-up after a session (Priority: P1)

After ending a session, the teacher records a follow-up assignment for the student covering one of six types (`hifz | muraja | recitation | tajweed | writing | listening`). The follow-up lands in `assigned` and the student is notified.

**Why this priority**: P1 — the entire follow-up loop assumes teacher-created assignments. Without this path, students have nothing to mark ready and grade.

**Independent Test**: As teacher → end a session → fill follow-up form → submit. Verify `homework_assignments` row with `status='assigned'`, correct `homework_type`, `booking_id` linking to the session that triggered it, student receives in-app notification.

**Acceptance Scenarios**:

1. **Given** a completed `bookings` row for student S and teacher T, **when** T calls `createHomework()` with `type='hifz'`, `title='Memorise Surah Al-Fatihah'`, `due_at=<+3 days>`, **then** an `homework_assignments` row exists with `status='assigned'`, `student_id=S`, `teacher_id=T`, `booking_id=<the completed session>`, and `notify(student_id, 'homework_assigned', ...)` was dispatched.
2. **Given** the follow-up has `review_horizon='near'` (or `'far'`), **when** the row is inserted, **then** the partial index `homework_assignments(student_id, review_horizon, status) WHERE review_horizon IN ('near','far')` makes the murajaah scheduler's nightly query fast at 50k DAU.
3. **Given** the follow-up requires audio, **when** the student later submits via `markStudentReady()` with an audio file, **then** the file lands in Supabase Storage and `audio_url` + `audio_duration_seconds` are populated on the row.

### User Story 2 — Student marks a follow-up as ready (Priority: P1)

The student completes the follow-up (memorises, practices, records audio) and clicks "I'm Ready" to send it back to the teacher for grading.

**Why this priority**: P1 — the loop closes here. Without student action, no follow-up reaches the teacher's grade queue.

**Independent Test**: As student → `/student/follow-up` → find an `assigned` row → click "I'm Ready" → optionally upload audio → submit. Verify `status='student_ready'`, `student_ready_at` populated, teacher receives notification.

**Acceptance Scenarios**:

1. **Given** an `assigned` follow-up F for student S, **when** S calls `markStudentReady(F)` with optional audio, **then** the row transitions to `student_ready`, the audio (if any) is uploaded to Storage, and `notify(teacher_id, 'homework_ready', ...)` fires.
2. **Given** F is in `student_ready` already (race: double-click), **when** S calls again, **then** the action rejects (TS guard at `homework.ts:156` returns "حالة المتابعة لا تسمح بهذا الإجراء"). No double-notification.
3. **Given** F was created against a booking that has since been cancelled, **when** S marks ready, **then** the action still succeeds — follow-ups are independent of booking state once created.

### User Story 3 — Teacher grades a follow-up and triggers auto-regeneration if needed (Priority: P1)

The teacher reviews the student's submission and assigns one of four grades: `excellent | good | needs_work | not_done`. For `needs_work` and `not_done`, a new follow-up is auto-created in `assigned` state with `parent_assignment_id` pointing back to the graded row, so the student gets another attempt.

**Why this priority**: P1 — auto-regeneration is the unique complexity of this domain. Wrong implementation = students either never re-attempt poor work or get infinite-loop assignments.

**Independent Test**: Grade an `student_ready` follow-up as `needs_work`. Verify (a) original row transitions to `completed_needs_work`, (b) a new row exists with `status='assigned'`, `parent_assignment_id=<original.id>`, (c) student notified, (d) `homework.graded` event emitted.

**Acceptance Scenarios**:

1. **Given** F in `student_ready`, **when** T calls `gradeHomework(F, grade='excellent')`, **then** F transitions to `completed_excellent` (terminal), no auto-regen, student notified with grade.
2. **Given** F in `student_ready`, **when** T grades `needs_work`, **then** F → `completed_needs_work` AND a new row N exists with `assigned`, `parent_assignment_id=F.id`, `assigned_at=now()`. Student gets one notification combining both events.
3. **Given** F is the third row in a `parent_assignment_id` chain (3rd attempt), **when** T grades `not_done` again, **then** auto-regen still runs (no depth cap currently — see edge cases). Operator may want to add depth-cap policy in Phase 2.
4. **Given** F is graded `not_done` AND the student's parent is configured to receive reports, **when** the grade lands, **then** `notify(parent, 'homework_not_done', ...)` fires via `dispatchNotification` parent path (PB-04 routing).

### User Story 4 — Teacher edits a follow-up before next session (Priority: P2)

A teacher who realises they got the title wrong, or wants to add details, can edit a follow-up in `assigned` or `student_ready` state — but only until the *next* booking with this student starts. Once a session has begun after `assigned_at`, the follow-up is frozen.

**Why this priority**: P2 — important UX (saves teachers from re-creating), but not load-bearing.

**Independent Test**: As teacher → find a recent follow-up → edit title → save. Then book + start a new session with the same student → re-edit → action rejects.

**Acceptance Scenarios**:

1. **Given** F is `assigned` AND no session has started after `F.assigned_at`, **when** T calls `editHomework(F, ...)`, **then** the update succeeds.
2. **Given** F is `student_ready` AND a new session has begun after `F.assigned_at`, **when** T attempts to edit, **then** the action rejects (TS guard at `homework.ts:388` checks `scheduled_at > assigned_at`).
3. **Given** F is graded (any `completed_*`), **when** T edits, **then** the action rejects (immutability comment at line 370). Today this is comment-only enforcement — TS-side; no DB constraint backstop. (D-003.)

### User Story 5 — Teacher deletes a follow-up (Priority: P3)

A teacher who created a follow-up by mistake can delete it before the student marks ready. Deletion is hard-delete; no soft-delete column today.

**Why this priority**: P3 — recovery action; rare.

**Independent Test**: Create a follow-up, then delete it. Verify the row is gone and the student does not receive a stale notification.

**Acceptance Scenarios**:

1. **Given** F is `assigned`, **when** T calls `deleteHomework(F)`, **then** the row is removed AND any pending in-app notification for `homework_assigned` is best-effort revoked.
2. **Given** F is `student_ready` (student already submitted), **when** T attempts deletion, **then** the action rejects — teacher must grade or explicitly cancel via a different path. (Today this guard may be missing — see edge cases / D-001.)

### Edge Cases

> *AI-drafted pending operator review.* Operator delegated drafting in lifecycle 1; same pattern here. Replace or extend with real production scars before merge or in a follow-up commit.

- **Auto-regen depth: no cap.** A student stuck in a `needs_work → needs_work → ...` loop generates an unbounded chain via `parent_assignment_id`. At 50k DAU, a few stuck students could produce thousands of orphan-attempt rows. Operator may want a chain-depth check (e.g., reroute to teacher-side intervention after 3 failed attempts) — currently absent.
- **Audio submission with file upload failure mid-`markStudentReady`.** Audio uploads to Supabase Storage, then the row updates. If Storage succeeds but DB update fails (or vice versa), the system can land with `status='student_ready'` but `audio_url=NULL` (or with an orphan file in Storage). No transactional path between Storage and DB.
- **Edit window race vs. booking confirm.** Teacher starts editing a follow-up, student books a new session that confirms while the edit form is open. The TS pre-check at `homework.ts:388` runs at submit time, so the edit may succeed if the timing is just-so — but the next session has effectively already started. Acceptance Scenario 4.2 says reject; the race window is small but exists.
- **`review_horizon` mismatch.** A follow-up with `review_horizon='near'` is graded `excellent` (terminal). The murajaah scheduler may still pick it up via the partial index until the next nightly recompute. Stale-by-cache, self-heals overnight.
- **Cross-booking follow-ups.** A teacher creates a follow-up that references `booking_id` from a 30-day-old session. Today nothing prevents this. Edge case for retention reporting: which session "owns" the follow-up?
- **Parent_assignment_id orphan.** If the parent assignment is hard-deleted via `deleteHomework()`, the FK in `v10_002_homework.sql:65` is `REFERENCES homework_assignments(id)` without `ON DELETE` clause documented. Behavior depends on the FK constraint default (RESTRICT or CASCADE). Verify in research.md / data-model.md.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist follow-up state in `homework_assignments.status` using the `homework_status` ENUM (`assigned | student_ready | completed_excellent | completed_good | completed_needs_work | completed_not_done`). All transitions enforced at the TS layer in `src/lib/actions/homework.ts`.
- **FR-002**: Only the assigned teacher MUST be able to create, edit, grade, or delete a follow-up. Students MUST NOT be able to call `createHomework`, `gradeHomework`, `editHomework`, or `deleteHomework`. Enforced at route adapter via `requireRole(...)`.
- **FR-003**: Only the student to whom the follow-up was assigned MUST be able to call `markStudentReady`. Enforced at route adapter and inside the action via `student_id = auth.uid()` check.
- **FR-004**: When a follow-up is graded `completed_needs_work` or `completed_not_done`, the system MUST atomically create a new `homework_assignments` row with `status='assigned'`, `parent_assignment_id=<graded-row.id>`, and the same `student_id` / `teacher_id` / `homework_type`. Auto-regeneration runs inline in `gradeHomework()`.
- **FR-005**: Audio submissions MUST be uploaded to Supabase Storage before `homework_assignments.status` flips to `student_ready`. If the upload fails, the status MUST NOT change.
- **FR-006**: Editing a follow-up MUST be rejected if any session for the student-teacher pair has `scheduled_at > F.assigned_at`. The teacher's edit window closes at next-session-start.
- **FR-007**: Editing a follow-up that is in any `completed_*` state MUST be rejected. Today this is enforced by a TS comment guard at `src/lib/actions/homework.ts:370`; no DB-level constraint exists. (D-003.)
- **FR-008**: Every state-changing server action that writes to `homework_assignments` MUST go through `loudAction` (per CLAUDE.md "No Silent Failures Policy"). [DRIFT — see "Known divergences from production" below.]
- **FR-009**: Notifications dispatched per state transition: `assigned → student`, `student_ready → teacher`, `completed_*  → student`, `completed_not_done → parent` (additional). Failures are best-effort and never block the state transition (Constitution Principle III).
- **FR-010**: Auto-regenerated follow-ups inherit `review_horizon` from the parent. The murajaah scheduler reads this via the partial index `homework_assignments(student_id, review_horizon, status) WHERE review_horizon IN ('near','far')`.

### Key Entities

- **HomeworkAssignment** (`public.homework_assignments`): canonical follow-up record. Self-references via `parent_assignment_id` for auto-regenerated chains. Carries `review_horizon` (added 2026-05-05) bridging to murajaah scheduler.
- **Booking** (`public.bookings`): provides `booking_id` foreign key — every follow-up is created as a result of a session.
- **Session** (`public.sessions`): the run-time artefact whose `scheduled_at` informs the edit-window check.
- **AudioFile** (Supabase Storage bucket, referenced via `homework_assignments.audio_url`): student's recitation/recording. Added 2026-05-04.
- **Notification** (`public.notifications`): downstream record per state transition.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ≥99% of `assigned → student_ready` transitions complete within 10 seconds of student "I'm Ready" click (audio upload latency budget at 50k DAU; up to 5 MB audio).
- **SC-002**: Auto-regeneration on `needs_work` / `not_done` runs in the same DB transaction as the grade — zero observed cases of "graded row exists but no auto-regen row" in production.
- **SC-003**: Edit-window enforcement catches 100% of edits attempted after next-session-start (Acceptance 4.2).
- **SC-004**: At 50k DAU with ~5 follow-ups/student/month avg, `homework_assignments` write rate stays under DB connection-pool saturation; no follow-up action exceeds P95 latency 1500ms (audio uploads contribute most of the tail).
- **SC-005**: Murajaah scheduler nightly query against `homework_assignments` (filtered by `review_horizon`) completes within budget (<30 minutes for 50k students × ~10 in-flight follow-ups each).

## When this lifecycle fails

- **PB-02 — Teacher missed a session** (upstream of follow-up creation): if a session is `no_show` with `no_show_party='teacher'`, no `createHomework()` is expected. If one exists, it's spurious — admin disambiguates.
- **PB-04 — Parent complaint about teacher**: parent reports may cite `not_done` notifications as triggers ("my child got 3 not_done in a row"). Auto-regen depth (or lack thereof) is the relevant data.
- **PB-05 — n8n workflow in failure loop**: `homework.graded` and `homework.not_done` events feed parent-report and reteach workflows. If those loop, follow-up grading still works (events are fire-and-forget) but notifications stop reaching parents.

## Known divergences from production (filed as follow-up issues at end of Phase 1)

- **D-001**: **All 6 server actions in `src/lib/actions/homework.ts` are unwrapped** — `createHomework`, `markStudentReady`, `gradeHomework`, `editHomework`, `getHomeworkAudioUrl`, `deleteHomework`. None use `loudAction`. This is a larger Principle II drift than booking domain (which had 4/7 wrapped). FR-008 codifies the target; remediation lands in Phase 2 audit.
- **D-002**: **No DB trigger** for `homework_status` transitions. Booking has `validate_booking_status`; follow-up does not. All state-machine enforcement is TS pre-check at `homework.ts:156`, `:252`, etc. Phase 2 candidate to add `validate_homework_status` parallel to the booking one.
- **D-003**: **Graded-immutability is comment-only.** `homework.ts:370` has a comment explaining why `completed_*` rows shouldn't be edited, but the actual enforcement is the same TS function. A bypass path (e.g., admin SQL ad-hoc UPDATE) would silently corrupt graded rows. Add a CHECK constraint or trigger in Phase 2.
- **D-004**: **No depth cap on `parent_assignment_id` chains.** A student stuck in `needs_work` loops generates unbounded auto-regen rows. Edge case 1 above. Phase 2 candidate: cap chain length at N (5? operator decides) and route past-N to teacher reteach panel (cf. murajaah scheduler's "items 8+ days overdue route to teacher").
- **D-005**: **`parent_assignment_id` FK has no documented `ON DELETE` clause.** `v10_002_homework.sql:65` declares `REFERENCES homework_assignments(id)` without specifying CASCADE/RESTRICT. Behavior depends on Postgres default (RESTRICT). Edge case 6 above; verify and document in research.md.

## Assumptions

- Authentication and authorization happen at the route adapter via `requireRole(...)` (Constitution Principle IV). Domain functions in `src/lib/actions/homework.ts` receive already-authenticated structured input; FR-002 and FR-003's role-based access are enforced at the boundary, not inside follow-up domain functions.
- The `homework_status` ENUM is canonical and not extended in this PR.
- Bilingual UX rule (constitution): user-facing strings use "follow-up" / "متابعة"; database identifiers (`homework_assignments`, `homework_status`, etc.) and code function names (`createHomework`, etc.) are kept as-is per the "rename not worth blast radius" pattern.
- Audio-file size cap is enforced upstream (UI `<input accept=...>` + Supabase Storage policy), not in this spec.
- Multi-tenancy is single-tenant; RLS uses role membership.
- This spec covers the V10 follow-up domain. Murajaah scheduler (spec 001) is a separate domain that *reads* `homework_assignments` via `review_horizon` but does not write it.

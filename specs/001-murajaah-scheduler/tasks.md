# Tasks: Murajaah Scheduler (SM-2 v1)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Data model**: [data-model.md](./data-model.md)

> Unblocked by spec 010 (ḥifẓ capture, merged) — `student_progress` now has real `progress_type='new'` rows to schedule.

## Format: `[ID] [P?] [Story] Description`

## Phase 2: Foundational — SM-2 data model (student-side) ✅ shipped (PR feat/001-murajaah-sm2-foundation)
- [x] **T001** Migration `murajaah_scheduler_sm2_foundation`: `student_review_schedule` table + 2 indexes + `updated_at` trigger.
- [x] **T002** Student + admin RLS (student sees/updates own rows; admin all). **Teacher RLS deferred — see T010.**
- [x] **T003** Seed `platform_settings`: `sm2_initial_interval_days=1`, `sm2_easiness_factor=2.5`, `sm2_lapse_penalty=0.8` (FR-006).
- [x] **T004** `compute_murajaah_batch_for_date(date)` — nightly seed (`progress_type='new'` only) + 7-day fresh-window batch, ≤15/student, oldest-first (FR-008/011); `service_role` only.
- [x] **T005** `complete_review(schedule_id, quality)` — per-review SM-2 recompute (EF clamp [1.3,3.5], q<3 resets interval), `SECURITY INVOKER` + student RLS (FR-004/007).
- [x] **T006** Local-PG verification of the SM-2 math + batch filter.

## Phase 3: User Story 1 — student sees today's batch (P1) 🎯 MVP — NEXT
- [ ] **T007** [US1] `markReviewComplete` server action (`src/lib/domains/progress/` or `review/`) — `loudAction` + `requireRole("student")`, calls `complete_review` rpc, `<ActionFeedback>` (FR-004/007).
- [ ] **T008** [US1] Rewrite the v0 `murajaah-card.tsx` to render today's batch (`batch_for_date = student-local today`, FR-012) with "بدأت / أنهيت المراجعة" buttons; hide when empty.
- [ ] **T009** [US1] Wire the nightly compute: n8n workflow at 02:00 UTC → `compute_murajaah_batch_for_date(student-local tomorrow)`; **retire the v0 cron** (FR-014) in the same PR.

## Phase 4: User Story 2 — teacher reteach queue (P2) — BLOCKED on a decision
- [ ] **T010** [US2] Resolve teacher↔student relationship (data-model assumed non-existent `teacher_student_assignments`; likely `bookings`). Then: teacher RLS + `mark_reteach_complete` (FR-013) + the 8+-day-overdue reteach panel.

## Phase 5: User Story 3 — admin SM-2 tuning (P3)
- [ ] **T011** [US3] `/admin/settings` "إعدادات المراجعة" — edit the 3 `sm2_*` settings (audit-logged, FR-006).

## Deferred-decision notes (flagged to operator)
- **Teacher-student model** (T010): `teacher_student_assignments` doesn't exist — pick the real mechanism before the teacher surface ships.
- **`progress_type` filter**: foundation schedules only `new` items; confirm reviews/corrections should not also be scheduled.

# Research: Follow-up Lifecycle (دورة حياة المتابعة)

**Branch**: `004-followup-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures *already-made* decisions that produced the current shipped follow-up implementation. It is a record, not a design exercise.

---

## Decision 1 — TS-only state-machine enforcement (no DB trigger)

**Choice**: Allowed `homework_status` transitions are enforced by TypeScript pre-checks inside `src/lib/actions/homework.ts` server actions. **There is no `validate_homework_status` PostgreSQL trigger** parallel to booking's `validate_booking_status`.

**Rationale (reconstructed)**:
- The follow-up domain shipped in V10 (after booking V1). At V10 time the team had `validate_booking_status` as the precedent but the follow-up state machine seemed simpler (only one state has multiple outgoing edges: `student_ready → completed_*`). TS pre-checks in a single owner file felt sufficient.
- The transition policy is more nuanced than booking — auto-regeneration on `needs_work`/`not_done` happens at TS time AS PART OF the grade transition, not as a separate post-condition. Encoding that in a SQL trigger would have meant duplicating the regen logic in PL/pgSQL.

**Drift recognised**: D-002 in spec.md flags that any bypass path (admin SQL ad-hoc UPDATE, future edge function, n8n direct DB write) silently violates the state machine. Phase 2 candidate: add `validate_homework_status` trigger that enforces the 6→6 transitions but doesn't try to re-implement auto-regen (regen stays in TS).

**Trade-off**: gained simplicity at V10, accumulated risk over time. The risk has not yet manifested in production, but the architectural inconsistency between booking (DB-trigger backstop) and follow-up (TS-only) is real.

---

## Decision 2 — Auto-regeneration is inline in `gradeHomework()`, not a Postgres function

**Choice**: When a teacher grades `needs_work` or `not_done`, the new follow-up row is created by a Supabase JS `.from('homework_assignments').insert(...)` call inside `gradeHomework()` at `src/lib/actions/homework.ts` (around line 270–290), *immediately after* the UPDATE that sets the original row's status to `completed_*`.

**Rationale (reconstructed)**:
- At V10 implementation time, the team prioritized shipping the auto-regen feature quickly. Two-step Supabase calls inside one server action were the path of least resistance.
- The regen logic depends on context already in TS scope (`student_id`, `teacher_id`, `homework_type`, `parent.review_horizon`) — encoding it in a Postgres function would have required passing all that state into the function or fetching it inside the function (extra query).

**Atomicity concern (Principle III)**: spec.md FR-004 says "atomically create" — but Supabase JS client does not implicitly wrap multiple `.from()` calls in a transaction. Whether they actually run as one transaction depends on the underlying PostgREST connection behavior. **This is the open question for Phase 2 research.**

**Verification path**:
- Read `src/lib/actions/homework.ts` lines 250–310 to confirm the pattern.
- Test by injecting a SQL error between the UPDATE and INSERT (e.g., temporary `RAISE EXCEPTION` in a CHECK constraint) and observing whether the UPDATE rolls back.
- If NOT atomic: migrate to a Postgres function `grade_homework_with_regen(p_id uuid, p_grade text)`. Same shape as `deduct_package_session()`.

**Trade-off**: shipping speed at V10 vs. atomicity guarantee long-term. Phase 2 research item.

---

## Decision 3 — Audio submission uses Supabase Storage, not Bunny CDN

**Choice**: Audio files for follow-up submissions live in a Supabase Storage bucket; the public URL is stored in `homework_assignments.audio_url` (column added 2026-05-04 via `20260504210746_add_homework_audio_submission.sql`).

**Rationale (reconstructed)**:
- Bunny.net Stream is configured in CLAUDE.md env vars (`BUNNY_STREAM_*`) but is for *video* streaming (lessons, recorded sessions). Audio submissions are short (<5 minutes typical) and don't need video transcoding.
- Supabase Storage is colocated with the database. RLS policies on Storage buckets can mirror RLS on `homework_assignments` (only the assigned teacher and student can access an audio file).
- Server-side cost is lower for short audio than video.

**Storage pattern**: bucket name + path convention captured in `data-model.md`. Files are referenced via `getHomeworkAudioUrl()` action that mints signed URLs.

**Trade-off**: tighter coupling to Supabase (vs. Bunny). Acceptable since audio is small and per-row.

---

## Decision 4 — `review_horizon` column added 2026-05-05 to bridge to murajaah scheduler

**Choice**: `homework_assignments.review_horizon` is a text CHECK column with values `near | far | none`, added in `20260505131935_add_review_horizon_to_homework.sql`. A partial index on `(student_id, review_horizon, status)` filters to `near | far` to keep the murajaah nightly query fast.

**Rationale**:
- The murajaah scheduler (spec 001) needs to know which follow-ups are eligible for spaced-repetition review. Not every follow-up is — `tajweed` and `writing` types might not need review, while `hifz` does.
- Carrying the horizon on the row itself (rather than computing it from `homework_type` at query time) avoids a hot-path JOIN at scale (Constitution Scale Target Rule).
- The partial index is the correct shape for 50k DAU: it stays small (only `near`/`far` rows are indexed) while the full table grows.

**Cross-spec link**: spec 001 (murajaah-scheduler) consumes this column read-only via the partial index. spec 004 (this) writes the column at create time. They share `data-model.md` semantics for the column but no code path overlap.

---

## Decision 5 — Graded-row immutability is comment-only

**Choice**: When a follow-up is in any `completed_*` state, `editHomework()` rejects further edits via a TS pre-check that reads the row's current status. The only enforcement is the comment + check at `src/lib/actions/homework.ts:370`. **There is no DB CHECK constraint or trigger** that prevents an UPDATE to a `completed_*` row.

**Rationale (reconstructed)**:
- Symmetric with Decision 1 (no DB trigger). At V10 time the team prioritized TS-only enforcement.

**Drift recognised**: D-003 in spec.md. Real consequence: an admin running an ad-hoc SQL UPDATE to fix a typo in a graded row's title would succeed without warning, silently changing what the student was graded against.

**Phase 2 candidate**: add a CHECK constraint or trigger that rejects UPDATEs to columns other than `audio_url` (signed-URL refresh) when status starts with `completed_`.

---

## Decision 6 — Hard-delete with potential FK orphan (parent_assignment_id behaviour)

**Choice**: `deleteHomework()` performs a SQL `DELETE`, no soft-delete column. The `parent_assignment_id` foreign key declared in `v10_002_homework.sql:65` is `REFERENCES homework_assignments(id)` — the migration does not specify `ON DELETE CASCADE` or `ON DELETE SET NULL`.

**Rationale (reconstructed)**:
- Hard-delete simplifies the "teacher created by mistake" recovery flow.
- The FK omission was likely accidental at V10 time.

**Behaviour today** (Postgres default for FKs without explicit ON DELETE): **`NO ACTION`** (deferred RESTRICT). Attempting to delete a row that has child rows pointing to it via `parent_assignment_id` will FAIL with a foreign key violation. This means the auto-regen child blocks deletion of the parent — which is the safer default but undocumented.

**Verification path**: read `\d+ homework_assignments` against production to confirm. spec.md edge case 6 surfaces this; data-model.md will document it.

**Drift**: D-005 in spec.md. Phase 2 candidate: explicitly declare `ON DELETE SET NULL` (which would orphan the chain but allow parent deletion) OR `ON DELETE RESTRICT` (the current implicit behavior, made explicit). Operator decides.

---

## References

- `LIFECYCLES.md` §3 — original 3-state simplification of the actual 6-state machine.
- `EXCEPTION_PLAYBOOKS.md` PB-02, PB-04, PB-05 — operational playbooks invoked when this lifecycle fails.
- `CLAUDE.md` § "Bilingual UX" / migration `20260505191211_update_help_center_homework_label_to_followup.sql` — naming rule.
- `CLAUDE.md` § "Scale Target Rule" — why `review_horizon` is on the row, not in a JOIN.
- ADR-0004 — atomic-critical-path pattern (relevant for Decision 2 atomicity verification).
- spec 001 (murajaah-scheduler) — read-only consumer of `review_horizon`.
- `src/lib/actions/homework.ts` lines 124, 156, 214, 252, 341, 370, 388 — quoted in spec.md for FR / drift evidence.

# Tasks: Follow-up Lifecycle (دورة حياة المتابعة)

**Branch**: `004-followup-lifecycle` | **Date**: 2026-05-08
**Tracking issue**: #230 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

> Brownfield documentation spec — tasks are documentation-completeness, ship-the-PR, and file-followups. There is no TDD red-green-refactor cycle here because no source code is being changed by this PR. Same shape as `003-booking-lifecycle/tasks.md`. The follow-up domain has more documented drift (D-001 through D-005), so Phase B has 5 issues to file rather than 3.

---

## Phase A — Ship this PR (sequential, blocks merge)

### T1 · Commit, push, open PR (depends on: nothing)

- Run `git status` to confirm only `specs/004-followup-lifecycle/**` is staged plus the auto-regenerated `specs/INDEX.md`. The pre-existing `M AGENTS.md` and `M CLAUDE.md` from before this branch was created MUST NOT be staged.
- Commit message: `feat(specs): document follow-up lifecycle in spec-kit format (Closes #230)`
- The husky `lint-staged` hook will run `npm run specs:index && git add specs/INDEX.md` automatically. Verify the diff includes one new INDEX.md row.
- Push: `git push -u origin 004-followup-lifecycle`.
- Open PR with `gh pr create --title "feat(specs): document follow-up lifecycle in spec-kit format" --body "..."`. PR body MUST include `Closes #230` to satisfy Branch Hygiene NON-NEGOTIABLE.

**Acceptance**: PR opened, CI green, INDEX.md row shows `004-followup-lifecycle | Tasks-ready` (will flip to `Shipped` after merge + n8n nightly re-regen, same timing artefact as PR #226).

### T2 · Verify pre-commit regeneration (runs as part of T1)

- The husky `bash -c 'npm run specs:index && git add specs/INDEX.md'` task runs on commit. Verify cleanly.
- If `specs/INDEX.md` does NOT show the new row after commit, investigate `scripts/generate-specs-index.ts` and re-run manually.

**Acceptance**: `grep "004-followup-lifecycle" specs/INDEX.md` returns one matching row.

### T3 · Address PR review (depends on: T1)

- Operator review may flag any of:
  - The 6 AI-drafted edge case bullets in `spec.md` (replace with real production scars if available).
  - Missing FR (operator may know of a behaviour the FRs don't cover; descriptive stance means add it as a new FR rather than redesign).
  - Inaccurate cross-reference (e.g., `review_horizon` semantics vs. murajaah scheduler).
  - Wrong PB-XX cross-references (PB-02 / PB-04 / PB-05 chosen — operator may add PB-08 if locked-out students raise follow-up issues).
- Apply edits in-place. Pre-commit hook re-runs on each push.

**Acceptance**: All review comments resolved or routed to follow-up issues.

### T4 · Merge (depends on: T3)

- `gh pr merge <N> --squash --delete-branch`. Repo `delete_branch_on_merge: true` removes both remote and local branches.
- Issue #230 auto-closes via `Closes #230` keyword.
- The n8n nightly cron at 03:00 UTC re-regenerates `specs/INDEX.md` against main and flips the row to `Shipped | #<this-PR>`.

**Acceptance**: PR merged, issue #230 closed, INDEX.md row eventually shows Shipped.

---

## Phase B — File follow-up issues (depends on: T4)

Five separate issues, NOT scope-creep into this PR.

### T5 · File issue: D-001 — wrap all 6 follow-up actions in `loudAction`

- Title: `chore(loud-actions): wrap all 6 src/lib/actions/homework.ts server actions in loudAction`
- Body: cite spec.md D-001, plan.md Constitution Check Principle II 🔴 CRITICAL, and constitution Principle II (NON-NEGOTIABLE). Link the 6 file targets:
  - `createHomework` (line 44)
  - `markStudentReady` (line 139)
  - `gradeHomework` (line 221)
  - `editHomework` (line 348)
  - `getHomeworkAudioUrl` (line 446)
  - `deleteHomework` (line 482)
- Note: this issue rolls into the same Phase 2 audit batch as #227 (booking-side wraps). May ship as one combined audit PR.
- Label: `documentation`

**Acceptance**: GitHub issue created.

### T6 · File issue: D-002 — add `validate_homework_status` SQL trigger

- Title: `chore(bookings/followup): add validate_homework_status DB trigger to mirror validate_booking_status`
- Body: cite Decision 1 in research.md, spec.md D-002, the architectural inconsistency (booking has trigger backstop, follow-up does not).
- Proposed migration: PL/pgSQL `BEFORE UPDATE` trigger that rejects invalid `homework_status` transitions. Does NOT replace TS auto-regen logic; only catches bypass paths.
- Label: `enhancement`

**Acceptance**: GitHub issue created.

### T7 · File issue: D-003 — add CHECK or trigger preventing UPDATE of completed follow-ups

- Title: `chore(followup): add DB-level guard against UPDATEs to completed_* homework rows`
- Body: cite Decision 5 / D-003 / homework.ts:370. Real consequence: admin SQL ad-hoc UPDATE silently changes what a student was graded against.
- Proposed: trigger that allows UPDATE only to `audio_url` (signed URL refresh) when `OLD.status LIKE 'completed_%'`.
- Label: `enhancement`

**Acceptance**: GitHub issue created.

### T8 · File issue: D-004 — auto-regen chain depth cap

- Title: `feat(followup): cap parent_assignment_id chain depth and route to teacher reteach panel`
- Body: cite spec.md edge case 1 / D-004. Real risk at 50k DAU: a few stuck students generate thousands of orphan-attempt rows. Parallel to murajaah scheduler's "items 8+ days overdue → teacher" pattern (spec 001 FR-013).
- Operator decision needed: cap at N=3? N=5? When over-cap, route to a new "needs reteach" surface in the teacher panel (different from the existing reteach queue, since this is a stuck-on-grading signal vs. a stuck-on-overdue signal).
- Label: `enhancement`

**Acceptance**: GitHub issue created with operator decision noted.

### T9 · File issue: D-005 — declare explicit ON DELETE on parent_assignment_id FK

- Title: `chore(db): declare ON DELETE policy on homework_assignments.parent_assignment_id FK`
- Body: cite Decision 6 / D-005 / `v10_002_homework.sql:65`. Current behavior is implicit `NO ACTION` (deferred RESTRICT) — auto-regen children block deletion of their parent.
- Proposed: explicit `ON DELETE SET NULL` (orphans the chain, allows parent deletion) OR explicit `ON DELETE RESTRICT` (current behavior, made explicit). Operator decides; SET NULL is gentler for ops, RESTRICT is gentler for data integrity.
- Migration: `ALTER TABLE homework_assignments DROP CONSTRAINT ... ADD CONSTRAINT ... REFERENCES ... ON DELETE <choice>`.
- Label: `enhancement`

**Acceptance**: GitHub issue created.

---

## Phase C — Verification of documentation accuracy (parallel)

### T10 · Verify atomic-grade-and-regen behaviour [P]

- Open question from Decision 2 / plan.md Principle III ⚠️.
- Read `src/lib/actions/homework.ts` lines 250–310 to confirm whether the grade UPDATE and the auto-regen INSERT are wrapped in a transaction. Supabase JS client does NOT implicitly transaction-wrap `.from()` chains.
- If NOT atomic: file an issue (separate from D-001) proposing migration to a Postgres function `grade_homework_with_regen(p_id, p_grade)`. Spec.md SC-002 currently asserts atomicity; if false, update spec.md or add caveat.

**Acceptance**: research.md Decision 2 updated with verified or escalated finding.

### T11 · Verify FK ON DELETE behaviour against production [P]

- D-005 / Decision 6. Run `\d homework_assignments` against the live schema (via `supabase db pull` locally or psql against the Supabase MCP — but per CLAUDE.md gotcha, the MCP doesn't reach the FURQAN account; use browser at the Supabase dashboard).
- Confirm the actual `ON DELETE` clause (or absence thereof).
- Update data-model.md FK note with the verified clause.

**Acceptance**: data-model.md FK note matches reality.

### T12 · Operator review of AI-drafted edge cases [P]

- Same pattern as PR #226 / `003-booking-lifecycle/tasks.md` T10.
- 6 edge cases in spec.md `### Edge Cases` are AI-drafted, marked pending operator review.
- Operator: confirm, replace, or remove each.

**Acceptance**: marker removed from spec.md.

### T13 · Cross-reference PB-02 / PB-04 / PB-05 accuracy [P]

- Verify the three playbooks still match what would resolve a follow-up failure.
- Reconcile if `EXCEPTION_PLAYBOOKS.md` has been updated since 2026-05-08.

**Acceptance**: spec.md "When this lifecycle fails" section verified.

---

## Dependency graph

```
T1 (commit/push/PR) ──► T2 (verify regen) ──► T3 (review) ──► T4 (merge)
                                                                  │
                                                                  ├─► T5 (issue: D-001)
                                                                  ├─► T6 (issue: D-002)
                                                                  ├─► T7 (issue: D-003)
                                                                  ├─► T8 (issue: D-004)
                                                                  └─► T9 (issue: D-005)

T10 [P], T11 [P], T12 [P], T13 [P]   ── can run any time pre or post merge
```

`[P]` = parallelizable, no inter-dependency.

## Notes for `/speckit.implement`

Same as `003-booking-lifecycle`: this is brownfield documentation; no source code is changed. T1–T4 are git operations; T5–T9 are GitHub issue creation; T10–T13 are read-only verification. Do not write under `src/`. Per Constitution Principle V, brownfield documentation specs ship without code changes.

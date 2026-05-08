# Tasks: Booking Lifecycle (دورة حياة الحجز)

**Branch**: `003-booking-lifecycle` | **Date**: 2026-05-08
**Tracking issue**: #225 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

> Brownfield documentation spec — tasks are documentation-completeness, ship-the-PR, and file-followups. There is no TDD red-green-refactor cycle here because no source code is being changed by this PR. Each task maps to either (a) a verification action that confirms or corrects content already in the spec/plan/data-model, or (b) a follow-up GitHub issue filed against documented drift.

---

## Phase A — Ship this PR (sequential, blocks merge)

### T1 · Commit, push, open PR (depends on: nothing)

- Run `git status` to confirm only `specs/003-booking-lifecycle/**` is staged plus the auto-regenerated `specs/INDEX.md`. The pre-existing `M AGENTS.md` and `M CLAUDE.md` from before this branch was created MUST NOT be staged.
- Commit message: `feat(specs): document booking lifecycle in spec-kit format (Closes #225)`
- The husky `lint-staged` hook will run `npm run specs:index && git add specs/INDEX.md` automatically. Verify the diff includes one new INDEX.md row.
- Push: `git push -u origin 003-booking-lifecycle`.
- Open PR with `gh pr create --title "feat(specs): document booking lifecycle in spec-kit format" --body "..."`. PR body MUST include `Closes #225` to satisfy Branch Hygiene NON-NEGOTIABLE.

**Acceptance**: PR opened, CI green, INDEX.md row shows `003-booking-lifecycle | Open` with the PR linked.

### T2 · Verify pre-commit regeneration (runs as part of T1)

- The husky `bash -c 'npm run specs:index && git add specs/INDEX.md'` task runs on commit. Verify it executed cleanly (no errors, INDEX.md changed).
- If `specs/INDEX.md` does NOT show the new row after commit, the regeneration failed silently — investigate `scripts/generate-specs-index.ts` and re-run manually.

**Acceptance**: `grep "003-booking-lifecycle" specs/INDEX.md` returns one matching row.

### T3 · Address PR review (depends on: T1)

- Operator review may flag any of:
  - Edge cases (the 6 AI-drafted bullets in spec.md `### Edge Cases` are explicitly marked "AI-drafted pending operator review" — replace with real production scars if available).
  - Missing FR (operator may know of a behaviour the FRs don't cover; descriptive stance means add it as a new FR rather than redesign).
  - Inaccurate cross-reference (e.g., a PB-XX that doesn't fit; a Decision that doesn't match production).
- Apply edits in-place. The pre-commit hook re-runs `npm run specs:index` on each push.

**Acceptance**: All review comments resolved or routed to follow-up issues.

### T4 · Merge (depends on: T3)

- `gh pr merge <N> --squash --delete-branch`. Repo `delete_branch_on_merge: true` removes both remote and local branches.
- Issue #225 auto-closes via `Closes #225` keyword in PR body.
- Verify `specs/INDEX.md` on `main` shows the new row with `Shipped` status linking to the merged PR (the post-merge regeneration runs in main's husky).

**Acceptance**: PR merged, issue #225 closed, INDEX.md row shows Shipped.

---

## Phase B — File follow-up issues (depends on: T4)

These are **separate** issues, **not** scope-creep into this PR. Each tracks a documented divergence from the constitution that this descriptive spec captured but did not remediate.

### T5 · File issue: D-001 — wrap 3 booking actions in `loudAction`

- Title: `chore(loud-actions): wrap createBooking, updateBookingStatus, recreateRoom in loudAction`
- Body: cite `specs/003-booking-lifecycle/spec.md` D-001 and FR-008, the constitution Principle II (NON-NEGOTIABLE), and link the 3 file:line targets:
  - `src/app/student/bookings/new/actions.ts:89`
  - `src/app/teacher/dashboard/actions.ts:34`
  - `src/app/teacher/dashboard/actions.ts:550`
- Label: `phase-2-audit`
- This issue rolls up into the Phase 2 audit PR series defined in the parent plan at `/Users/drdeeb/.claude/plans/act-as-a-senior-starry-lerdorf.md`.

**Acceptance**: GitHub issue created, labelled, linked from the merged PR's "Closes #" mismatch list.

### T6 · File issue: D-002 — `cancel_reason` enum normalization

- Title: `chore(bookings): consider enum + detail-text split for bookings.cancel_reason`
- Body: cite Decision 4 in research.md, link to admin reporting pain points if known. Mark as `priority: low` until admin reporting demand surfaces.
- Label: `tech-debt`

**Acceptance**: Issue created.

### T7 · File issue: D-003 — `startInstantSession()` skips package balance check

- Title: `bug(bookings): startInstantSession bypasses package-balance check (FR-009 violation)`
- Body: cite contracts/createBooking.md FR-009, point at `src/app/teacher/dashboard/actions.ts:694`. This is a real bug, not just doc drift — student can have an instant session deducted against an exhausted package.
- Label: `bug`, `phase-2-audit`

**Acceptance**: Issue created.

---

## Phase C — Verification of documentation accuracy (parallel, post-merge or pre-merge)

These tasks verify that the descriptive spec actually matches production. If any of them surfaces a mismatch, file an issue and consider a documentation-fix PR (not a code PR).

### T8 · Verify `confirm_booking_with_session()` SQL function exists [P]

- `plan.md` Principle III references this Postgres function as the atomic critical path. The constitution names it directly. Verify it exists in `supabase/migrations/`.
- Search: `grep -rn "confirm_booking_with_session" supabase/migrations/ src/lib/supabase/migrations/`
- If MISSING: research.md Decision 3 still holds (Daily.co before DB write), but the atomicity claim weakens — current code may be doing two-step UPDATEs in a server action. Update plan.md Principle III with the actual current state and file an issue tracking the gap.

**Acceptance**: Function presence confirmed OR plan.md updated to reflect actual state.

### T9 · Verify slot uniqueness constraint [P]

- `contracts/updateBookingStatus.md` says SC-002's "zero double-bookings" target is enforced by an index on `(teacher_id, scheduled_at) WHERE status IN ('pending', 'confirmed')`. The contract notes "current state may not have this UNIQUE constraint".
- Verify by reading migrations or running `\d bookings` against production schema.
- If MISSING: this is edge case 5 in spec.md ("Slot race from two students"). File a separate issue tracking the missing UNIQUE.

**Acceptance**: Index/UNIQUE presence confirmed OR new issue filed.

### T10 · Operator review of AI-drafted edge cases [P]

- The 6 edge cases in spec.md `### Edge Cases` are AI-drafted, marked pending operator review.
- Operator reads each bullet and either: (a) confirms it matches a real production scar, (b) replaces it with the actual scar, or (c) deletes if it's purely speculative.
- Edits land as a separate small commit on `main` (post-merge) or as part of T3 (pre-merge).

**Acceptance**: All 6 bullets either kept-with-confirmation, replaced, or removed. The "AI-drafted pending operator review" note removed from spec.md.

### T11 · Cross-reference PB-01, PB-02, PB-06 accuracy [P]

- `spec.md` "When this lifecycle fails" cites three playbooks. Verify each playbook's content still matches what would resolve the lifecycle failure described.
- If `EXCEPTION_PLAYBOOKS.md` has been updated since 2026-05-08, reconcile.

**Acceptance**: All three PB cross-references confirmed accurate, OR spec.md updated.

---

## Dependency graph

```
T1 (commit/push/PR) ──► T2 (verify regen) ──► T3 (review) ──► T4 (merge)
                                                                  │
                                                                  ├─► T5 (issue: D-001)
                                                                  ├─► T6 (issue: D-002)
                                                                  └─► T7 (issue: D-003)

T8 [P], T9 [P], T10 [P], T11 [P]   ── can run any time pre or post merge
```

`[P]` = parallelizable, no inter-dependency.

## Notes for `/speckit.implement`

`/speckit.implement` typically executes tasks one-by-one against the codebase. For this brownfield documentation spec, **no source code is changed**. The "implementation" of tasks T1–T7 is git operations + GitHub issue creation; T8–T11 are read-only verification. If `/speckit.implement` is invoked against this `tasks.md`, it should:

1. Run T1–T4 as a sequence (commit, push, PR, merge).
2. After T4 completes, file T5–T7 issues via `gh issue create`.
3. Run T8–T11 as parallel verifications, surfacing any mismatch as a comment on the merged PR or as a new issue.
4. Not attempt to write source code under `src/` for any task in this file.

This deviation from the standard implement-the-feature flow is consistent with Constitution Principle V — brownfield documentation specs ship without code changes.

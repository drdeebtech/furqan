# Tasks: Package Deduction Lifecycle (دورة حياة الباقة)

**Branch**: `005-package-deduction-lifecycle` | **Date**: 2026-05-08
**Tracking issue**: #237 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

> Brownfield documentation spec — same shape as `003-booking-lifecycle/tasks.md` and `004-followup-lifecycle/tasks.md`. **This PR's merge closes Phase 1** of the broader plan (lifecycles → audit → modes). Phase 2 (audit) starts after.

---

## Phase A — Ship this PR (sequential, blocks merge)

### T1 · Commit, push, open PR (depends on: nothing)

- Stage only `specs/005-package-deduction-lifecycle/**`. The pre-existing `M AGENTS.md` and `M CLAUDE.md` MUST NOT be staged.
- Commit: `feat(specs): document package deduction lifecycle in spec-kit format (Closes #237)`
- Husky `lint-staged` regenerates INDEX.md.
- `git push -u origin 005-package-deduction-lifecycle`.
- `gh pr create --title "feat(specs): document package deduction lifecycle in spec-kit format" --body "..."` with `Closes #237`.

**Acceptance**: PR opened, CI green.

### T2 · Verify pre-commit regeneration (runs as part of T1)

**Acceptance**: `grep "005-package-deduction-lifecycle" specs/INDEX.md` returns one matching row.

### T3 · Address PR review (depends on: T1)

- Operator review of 6 AI-drafted edge cases (T12 below).
- Verify decisions against actual code where possible.

**Acceptance**: All review comments resolved or routed to follow-up issues.

### T4 · Merge (depends on: T3)

- `gh pr merge <N> --squash --delete-branch`.
- Issue #237 auto-closes.
- n8n nightly cron flips INDEX row to `Shipped`.

**Acceptance**: PR merged, issue #237 closed.

**Phase 1 completion**: T4 of this PR closes Phase 1 of the broader lifecycles → audit → modes plan. Phase 2 begins after.

---

## Phase B — File follow-up issues (depends on: T4)

5 separate issues, NOT scope-creep into this PR.

### T5 · File issue: D-001 — wrap 3 admin package actions in `loudAction`

- Title: `chore(loud-actions): wrap savePackage, deletePackage, togglePackageActive in loudAction`
- Body: cite spec.md D-001, plan.md Constitution Check Principle II ⚠️. Targets:
  - `src/app/admin/packages/actions.ts:14` — `savePackage`
  - `src/app/admin/packages/actions.ts:89` — `deletePackage`
  - `src/app/admin/packages/actions.ts:120` — `togglePackageActive`
- Note: this issue rolls into the same Phase 2 audit batch as #227 (booking-side) and #232 (follow-up-side). Single combined audit PR is feasible since these are all teacher/admin-facing.
- Label: `documentation`

**Acceptance**: GitHub issue created.

### T6 · File issue: D-002 — `refund_package_session()` companion function

- Title: `feat(packages): add refund_package_session() companion to deduct_package_session()`
- Body: cite spec.md edge case 3 / D-002. Real consequence: a wrongly-deducted session has no atomic undo. Phase 2 candidate when refund tooling is built out (e.g., admin "refund this session" button in `/admin/students/<id>/packages/<id>`).
- Proposed: SQL function `refund_package_session(p_package_id uuid, p_count integer DEFAULT 1)` that atomically decrements `sessions_used` if `sessions_used > 0`. Same plain-SQL + SECURITY DEFINER pattern as `deduct_package_session()`.
- Label: `enhancement`

**Acceptance**: GitHub issue created.

### T7 · File issue: D-003 — virtual `expired` state breaks reports

- Title: `chore(packages): add view or cron to surface effective package status (virtual exhausted/expired)`
- Body: cite spec.md D-003 + Decision 4. Reports filtering `WHERE status='expired'` undercount real expiries because the application never writes status='expired'. Same pattern for `exhausted` (virtual via counter predicate).
- Proposed (operator decides):
  - (a) Nightly cron flips status='expired' for predicate-positive rows (~30k writes/month).
  - (b) Query-time view `student_packages_v` with computed `effective_status` column. Reports use the view; mutations stay against the table. Recommended.
  - (c) Materialized view refreshed nightly. Compromise.
- Label: `enhancement`

**Acceptance**: GitHub issue created with operator's preferred option noted.

### T8 · File issue: D-004 — explicit per-mode fallback

- Title: `feat(packages): explicit prompt when deduct_package_session_mode falls back to legacy session_count`
- Body: cite spec.md edge case 4 / D-004 / Decision 3. A student whose halaqa enrolment silently consumes their private budget is a UX surprise.
- Proposed: at the booking flow, when `mode_counts->>'halaqa' = 0` AND `session_count > 0`, prompt the student: "Your halaqa budget is exhausted. Use 1 of your 8 private sessions instead?" Adds friction but removes surprise.
- Operator decision needed: prompt always, prompt only on >50% private consumption, or accept silent fallback.
- Label: `enhancement`

**Acceptance**: GitHub issue created with operator decision noted.

### T9 · File issue: D-005 — `cancel_reason` enum normalisation (parallel to D-002 in spec 003)

- Title: `chore(packages): normalize student_packages.cancel_reason to enum + detail-text split`
- Body: cite spec.md D-005. Same shape as the booking-side issue #228. May ship as one combined remediation (booking + package).
- Label: `enhancement`

**Acceptance**: GitHub issue created. Cross-reference #228.

---

## Phase C — Verification of documentation accuracy (parallel)

### T10 · Verify `student_packages.package_id` FK ON DELETE behaviour [P]

- data-model.md notes verification needed. Run `\d+ student_packages` to confirm.
- If `RESTRICT` (default): admin attempting to delete a `packages` row referenced by `student_packages` rows fails with FK violation. May want to surface a friendlier error in `deletePackage`.

**Acceptance**: data-model.md FK note matches reality; if missing, file follow-up issue.

### T11 · Verify SECURITY DEFINER persistence on deduct functions [P]

- research.md Decision 5 / FR-008. Run `\df+ deduct_package_session` and `\df+ deduct_package_session_mode` to confirm both still have `SECURITY DEFINER`.
- If lost (e.g., from a careless `CREATE OR REPLACE` migration): file urgent issue, this would break the deduction path under non-admin RLS.

**Acceptance**: both functions confirmed SECURITY DEFINER.

### T12 · Operator review of AI-drafted edge cases [P]

- 6 edge cases in spec.md, marked pending review. Same pattern as PR #226, #231.

**Acceptance**: marker removed from spec.md.

### T13 · Cross-reference PB-03 / PB-07 accuracy [P]

- Verify the two playbooks still match what would resolve a package-lifecycle failure.

**Acceptance**: spec.md "When this lifecycle fails" section verified.

### T14 · Verify TS callers of `deduct_package_session()` handle return value correctly [P]

- spec.md FR-002 acceptance scenario 2.3 + 2.4: when the function returns `null`, the caller MUST NOT proceed as if the deduction succeeded.
- Audit `src/lib/actions/group-session.ts:136` and `src/lib/actions/class-offerings.ts:233` and `endSession()` call site: do they check the return value?
- If any caller ignores the return value, file as bug (same shape as D-001 / Phase 2 audit).

**Acceptance**: all 3 call sites verified to handle null/false return correctly.

---

## Dependency graph

```
T1 (commit/push/PR) ──► T2 (verify regen) ──► T3 (review) ──► T4 (merge) ◀── PHASE 1 COMPLETE
                                                                  │
                                                                  ├─► T5 (issue: D-001)
                                                                  ├─► T6 (issue: D-002)
                                                                  ├─► T7 (issue: D-003)
                                                                  ├─► T8 (issue: D-004)
                                                                  └─► T9 (issue: D-005)

T10 [P], T11 [P], T12 [P], T13 [P], T14 [P]   ── parallel, pre or post merge
```

`[P]` = parallelizable, no inter-dependency.

## Notes for `/speckit.implement`

Same as `003-booking-lifecycle` and `004-followup-lifecycle`: brownfield documentation; no source code is changed by this PR. T1–T4 are git operations; T5–T9 are GitHub issue creation; T10–T14 are read-only verification. Do not write under `src/`. Per Constitution Principle V, brownfield documentation specs ship without code changes.

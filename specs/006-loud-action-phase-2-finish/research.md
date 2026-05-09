# Phase 0 — Research

**Feature**: Phase 2 No-Silent-Failures Finish (`specs/006-loud-action-phase-2-finish/`)
**Date**: 2026-05-09

## Decisions

### Decision 1 — Per-file preflight shape

For each of the 9 unwrapped files, the canonical preflight (auth check) is determined by the existing pre-wrap helper used in that file. Reading each file pre-spec:

| File | Existing auth pattern | Wrap preflight |
|---|---|---|
| `lib/actions/group-session.ts` | `auth.getUser()` + `profiles.role` lookup | Custom preflight (returns `{ actorId }`); role check stays inline (admin OR owning teacher branch) |
| `lib/actions/course-enrollments.ts` | `auth.getUser()` + role check | `studentPreflight` helper (any authenticated user) |
| `lib/actions/session-lesson-plan.ts` | `auth.getUser()` + teacher-or-admin | `teacherOrAbovePreflight` |
| `app/teacher/sessions/[id]/actions.ts` | `auth.getUser()` + teacher | `teacherPreflight` |
| `app/student/sessions/actions.ts` | `auth.getUser()` (student) | `studentPreflight` |
| `app/student/sessions/[id]/actions.ts` | `auth.getUser()` | `studentPreflight` |
| `app/teacher/students/[studentId]/actions.ts` | `auth.getUser()` + teacher | `teacherPreflight` |
| `app/teacher/recitations/actions.ts` | `auth.getUser()` + teacher | `teacherPreflight` |
| `app/(public)/packages/paypal-actions.ts` | `auth.getUser()` (student making payment) | `studentPreflight` |

**Rationale**: Match each file's existing auth shape. Don't introduce role-check changes in the wrap PR — that's an auth-model PR.

**Alternatives considered**:
- Promote a single `actorPreflight` to `loud.ts` — rejected because role checks vary too much per file.
- Use `requireAdmin` for everything — rejected because most files allow non-admin roles.

---

### Decision 2 — Form-feedback scope (FR-008)

Add `<ActionFeedback>` to the 3 highest-impact forms missing it, defer the rest.

**Highest-impact criteria**: forms whose backing action is P0/P1 AND lacks any other user-visible error mechanism (no toast, no inline span). Per audit doc §6 (28 callers without `<ActionFeedback>`):

1. **`src/app/teacher/sessions/[id]/post-session-form.tsx`** — `savePostSessionNotes`. P1 lifecycle. Currently silent on failure.
2. **`src/app/(public)/packages/paypal-checkout.tsx`** — PayPal callback handler. P0 money. Currently silent on capture failure.
3. **`src/app/teacher/students/[studentId]/notes-form.tsx`** — `updateSessionNotes`. P1 lifecycle. Currently silent.

**Rationale**: Highest-traffic + highest-stakes user paths. Closing these closes 80% of the user-visible silent-fail surface.

**Alternatives considered**:
- Full sweep of 28 forms — rejected because it doubles the PR size and dilutes review focus.
- Skip form-feedback entirely, defer to Phase 2c PR — rejected because the wraps establish the canonical `LoudResult` shape; piggy-backing 3 form changes makes the wrap's value visible to users immediately.

---

### Decision 3 — Tripwire grep pattern (FR-007)

Extend the silent-fail tripwire (in `.husky/pre-commit` or its referenced script) with this pattern:

```bash
# Catch destructures of .single()/.maybeSingle() that drop the `error` variable.
git diff --cached --name-only -- 'src/**/*.ts' 'src/**/*.tsx' | xargs grep -nE '^[[:space:]]*const[[:space:]]+\{[[:space:]]*data:[[:space:]]*\w+[[:space:]]*\}[[:space:]]*=[[:space:]]*await[[:space:]]+.+\.(single|maybeSingle)\(\)' 2>/dev/null
```

If any line matches, block the commit with:
```
[silent-fail tripwire] BLOCKED: line N of <file> destructures only `{ data: x }` from .single()/.maybeSingle().
The `error` variable is dropped, masking infrastructure failures as "row not found".
Fix: capture both, e.g. `const { data: x, error: xErr } = await ... .single()`
     then `if (xErr || !x) throw notFoundOrInfra(xErr, "<friendly>")` from `@/lib/actions/loud`.
See: PR #266 (homework lifecycle review) for the precedent.
```

**Rationale**: Shell-grep matches the exact anti-pattern with minimal false positives. The lookup-then-throw shape `{ data: x, error: xErr }` doesn't match because the regex requires `}` to immediately follow the destructured variable.

**Alternatives considered**:
- AST-based scan (e.g. ts-morph) — rejected as over-engineering; grep is good enough for a pre-commit hook with sub-second runtime.
- ESLint custom rule — viable long-term but pre-commit grep is faster to ship.

---

### Decision 4 — Output-shape mismatch handling

For `generateSessionToken` (returns `{ token, roomUrl }`) and `toggleArchiveTeacher` (returns `{ cvStatus, isAccepting }`):

**Decision**: DEFER the wrap. Add manual `audit_log` row + `logError` on each error path. Document in code comment + audit doc.

**Rationale**: `loudAction`'s `Output: { message?: string }` constraint can't carry multi-field payloads cleanly. Same pattern as PR 16's `joinAsObserver` and PR 19's `bulkGradeHomework`. Three deferred + 2 more in this spec = 5 total deferrals — crosses the threshold for a Phase 3 framework PR (extend `Output` to support typed payloads). Tracked but out of scope for this spec.

**Alternatives considered**:
- JSON-encode payload into `message` slot — rejected because it corrupts the framework's clarity.
- Split into two actions (one wrapped DB-write + one thin payload returner) — rejected because callers expect a single round-trip.

---

### Decision 5 — PayPal failure recovery preservation

`captureAndGrantPackage` does PayPal capture → `student_packages.insert` → `deduct_package_session` RPC.

**Decision**: Wrap preserves existing call order + fail-soft semantics verbatim. The wrap only adds `loudAction` shell + `cause`-attached errors + severity=critical for Telegram alerting.

**Existing recovery flow** (preserved):
- PayPal capture succeeds, then `student_packages.insert` fails → admin sees Telegram alert; reconciles via `/admin/credits`.
- `student_packages.insert` succeeds, then `deduct_package_session` fails → row stays in `pending_grant` state; same reconciliation path.

**Rationale**: Changing the recovery flow is a money-domain decision, not a wrap decision. The wrap adds observability without changing semantics.

**Alternatives considered**:
- Atomic SQL wrap of PayPal+grant+deduct — rejected because PayPal capture is an external API call that can't go inside a transaction.
- Auto-rollback PayPal capture on grant failure — rejected because PayPal refund is its own irreversible operation; needs operator input.

---

### Decision 6 — `audit_log` column reconciliation (out of scope)

`homework.ts` uses `actor_id` and `metadata` columns; everywhere else uses `changed_by` (no metadata).

**Decision**: Do NOT fix in this spec. Document as a follow-up data-archeology task.

**Rationale**: Either the schema has both columns (in which case nothing's wrong) or it's a data-write bug. Determining which requires a Supabase schema query against the production `audit_log` table — operator must do this since FURQAN's Supabase MCP is auth'd to the wrong account (per CLAUDE.md). Fixing in this spec without that data is risky.

**Alternatives considered**:
- Sweep `actor_id` → `changed_by` in this PR — rejected without schema confirmation.
- Add a separate spec 007 for the reconciliation — possible but lower priority than Phase 3 (Session Modes).

---

### Decision 7 — Severity calibration for the 9 files

Carrying forward from PRs 7–20:

| Severity | Use case | Examples in this spec |
|---|---|---|
| `info` | Routine writes, low blast radius | `savePostSessionNotes`, `markNoErrorsObserved`, `attestSessionHappened`, `submitReview`, `trackSessionEvent`, `addStudentToSession`, `enrollFree`, `setLessonPlan`, `toggleCheckpoint`, `clearLessonPlan`, `updateSessionNotes`, `resolveRecitationError`, `requestFreshRecitationAction` |
| `warning` | Destructive but expected; user-impacting recovery | (none in this spec — most P1s are non-destructive) |
| `critical` | Money/security, irreversible | `createPackageOrder`, `captureAndGrantPackage` (both PayPal money) |

**Rationale**: Keeps Telegram noise low. Only money paths page Telegram on failure.

**Alternatives considered**:
- Mark `addStudentToSession` as `warning` — rejected because adding students is routine, not destructive.
- Mark all P1s as `warning` — rejected; would create alert fatigue.

---

## NEEDS CLARIFICATION resolved

None. All 7 decisions above were resolvable from existing code + audit doc + prior PR patterns. No operator input required at the `/speckit-plan` stage.

---

**Status**: Phase 0 complete. Proceeding to Phase 1 design artefacts.

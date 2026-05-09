# Phase 1 — Data Model

**Feature**: Phase 2 No-Silent-Failures Finish
**Date**: 2026-05-09

> **No schema changes.** This spec adds rows to existing tables — primarily `audit_log` envelope rows — but introduces no new tables, columns, indexes, enums, or constraints.

## Entities

### `audit_log` envelope row (existing table; new rows only)

The framework writes one envelope row per wrapped action call. Already in production; this spec extends coverage to the 9 unwrapped files.

| Field | Type | Source | Notes |
|---|---|---|---|
| `changed_by` | uuid | `actorId` from `loudAction.preflight()` returned `{ actorId }` | Canonical column name across the codebase. NOT `actor_id`. |
| `table_name` | text | `loudAction.audit.table` config | E.g. `"sessions"`, `"bookings"`, `"recitation_errors"`, `"student_packages"`. |
| `record_id` | text | `loudAction.audit.recordId(input)` — function or static string | UUID or composite key (e.g. `"talqeen:{bookingId}"` for inserts pre-id). |
| `action` | text | `loudAction.audit.action` config | One of `"INSERT"`, `"UPDATE"`, `"DELETE"`. |
| `old_data` | jsonb (nullable) | `null` for envelope rows; populated only on diff rows written by the handler | Envelope row leaves this null. |
| `new_data` | jsonb (nullable) | `{ input }` cast for envelope row on success; `null` on failure | The framework's `writeAudit` casts the input via `as never`. |
| `reason` | text | `loudAction.audit.reasonPrefix` + `" OK"` or `" FAILED: <message>"` | Failure rows carry the cause's message. |
| `created_at` | timestamptz | DB default `now()` | — |

### `audit_log` diff row (existing pattern; preserved per file)

Some actions write a SECOND audit_log row inside the handler with old/new field snapshots. Examples from prior PRs: `updateSetting` (PR 7) preserves old/new value; `savePackage` (PR 9) preserves old/new price + name + is_active. This spec preserves any existing diff-row writes verbatim — does NOT consolidate them into the envelope.

**Why not consolidate?** The envelope row's `new_data` carries `{ input }`, which is the action's input shape — not the resulting database delta. Diff rows carry the delta (old/new), which serves a different audit query path (reconciliation scripts, change history).

### `loudAction` `LoudResult` (existing return type)

```ts
type LoudResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };
```

The wrapped Base returns `LoudResult`; the public wrapper translates back into the action's existing return shape. Public signatures are preserved per FR-005 — caller code does not change.

### `UserError` (existing per-file class)

```ts
class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}
```

Convention: every action file declares its own. Framework duck-types via `(err as { userError?: boolean }).userError === true`.

**This spec does not promote `UserError` to a shared module** — that would be an unrelated refactor. Per-file classes remain.

---

## Severity tiers (existing convention)

| Severity | Side effects on failure | Used for |
|---|---|---|
| `info` | `logError` to Sentry + `audit_log` FAILED row (when cause attached) | Routine writes; lowest blast radius |
| `warning` | Same as `info` | Destructive-expected; user-impacting recovery actions |
| `critical` | Same as `info` PLUS Telegram alert (`sendTelegramAlert` via `after()`) | Money / security / irreversible paths |

**This spec adds 2 `critical` actions (PayPal) and ~12 `info` actions.** No `warning` additions because none of the 9 files contain destructive-expected actions.

---

## Per-file action manifest

Source of truth for what each wrap touches.

### 1. `lib/actions/group-session.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `addStudentToSession` | `info` | `bookings.insert` (new student row), optional `sessions.update` (capacity bump) | Daily.co `updateRoomMaxParticipants` (best-effort), `deduct_package_session` RPC (best-effort) | 4 `.single()` sites use `notFoundOrInfra`. Existing audit_log row preserved. |

### 2. `lib/actions/course-enrollments.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `enrollFree` | `info` | `course_enrollments.insert` | None | Wrap target. |
| `initiateEnrollmentCheckout` | — | (Stripe-shaped, deferred) | Stripe (when keys land) | DEFERRED — Stripe keys not live. |

### 3. `lib/actions/session-lesson-plan.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `setLessonPlan` | `info` | `sessions.update` (lesson_plan jsonb) | None | P2. |
| `toggleCheckpoint` | `info` | `sessions.update` | None | P2. |
| `clearLessonPlan` | `info` | `sessions.update` | None | P2. |

### 4. `app/teacher/sessions/[id]/actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `savePostSessionNotes` | `info` | `sessions.update` + diff `audit_log` row (preserved) | None | Spec 003 contract reference. |
| `markNoErrorsObserved` | `info` | `sessions.update` | None | — |

### 5. `app/student/sessions/actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `attestSessionHappened` | `info` | `sessions.update` | None | Student attestation. |

### 6. `app/student/sessions/[id]/actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `generateSessionToken` | — | None | Daily.co token mint | DEFERRED — multi-field `{ token, roomUrl }` return. Manual audit_log added. |
| `submitReview` | `info` | `course_reviews.insert` | None | P2. |
| `trackSessionEvent` | `info` | `automation_logs.insert` | None | P2 best-effort. |

### 7. `app/teacher/students/[studentId]/actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `updateSessionNotes` | `info` | `session_notes_history.insert` + `sessions.update` | None | Dual-write; preserve order. |
| `resolveRecitationError` | `info` | `recitation_errors.update` | None | P2. |

### 8. `app/teacher/recitations/actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `requestFreshRecitationAction` | `info` | `homework_assignments.insert` | None | Sister of `createTalqeenHomework` (PR 19). |

### 9. `app/(public)/packages/paypal-actions.ts`

| Action | Severity | DB writes | External calls | Notes |
|---|---|---|---|---|
| `createPackageOrder` | **`critical`** | `payments.insert` | PayPal create-order API | Money path. |
| `captureAndGrantPackage` | **`critical`** | `student_packages.insert` + `deduct_package_session` RPC | PayPal capture API | Money double-write; preserve fail-soft semantics per Decision 5. |

---

## Counts

- **Wrapped actions**: 13 (`info` × 11, `critical` × 2)
- **Deferred actions** (loud-by-hand): 2 (`generateSessionToken`, `initiateEnrollmentCheckout`)
- **Total actions touched**: 15 across 9 files
- **`audit_log` envelope rows added per call**: 1 (framework-managed)
- **`audit_log` diff rows preserved**: 1 (in `savePostSessionNotes`)
- **External API calls preserved**: Daily.co (`addStudentToSession`, `generateSessionToken`), PayPal (both PayPal actions), `deduct_package_session` SQL RPC (`addStudentToSession`, `captureAndGrantPackage`)

---

**Status**: Phase 1 data-model complete. Proceeding to contracts.

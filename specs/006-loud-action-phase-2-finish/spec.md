# Feature Specification: Phase 2 No-Silent-Failures Finish

**Feature Branch**: `006-loud-action-phase-2-finish`
**Tracking Issue**: [#269](https://github.com/drdeebtech/furqan/issues/269)
**Created**: 2026-05-09
**Status**: Draft
**Input**: User description: "Phase 2 No-Silent-Failures finish — wrap the remaining 9 mutating server-action files in loudAction with cause-aware error handling, severity-calibrated audit_log writes, and consistent UserError discipline. Also includes Phase 2c form-feedback gap fixes, Phase 2d tripwire enhancement, and audit-doc regeneration."

> **Brownfield framing.** This is a refactor sweep that completes Phase 2 of the senior-engineer charter. It does not introduce a new owner-domain (Constitution Principle I) — it directly implements Principle II (Loud Failures NON-NEGOTIABLE) for the remaining server-action surface that PRs 7–20 left unwrapped or in non-canonical shape. The spec captures intent and acceptance criteria; the constitution gate at `/speckit.plan` should PASS because this work *is* the loud-failures principle made manifest.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator sees infrastructure errors in Sentry instead of silent "not found" (Priority: P1)

When a teacher tries to grade a follow-up and the underlying Supabase update fails (RLS regression, network blip, Postgres restart), the operator must see the genuine error in Sentry within 30 seconds. Currently the user sees "غير موجود" / "فشل العملية" and the underlying cause never reaches Sentry — operators only learn about regressions when users complain.

**Why this priority**: This is the primary value of Phase 2. Every wrapped action becomes diagnosable; every silent fail becomes a Sentry event with stack trace and structured context.

**Independent Test**: Pick one wrapped action (e.g. `savePostSessionNotes`). Force a Supabase update failure (e.g. by disabling the RLS policy in a Supabase preview branch). Submit the form. Confirm: (a) the user sees a friendly Arabic message, (b) Sentry receives an event tagged with the action name + `severity` + the underlying Postgres error message via `cause`.

**Acceptance Scenarios**:

1. **Given** a wrapped action with Supabase write failure, **When** the user submits, **Then** Sentry shows the cause and the user sees the friendly Arabic message — both within 30 seconds.
2. **Given** a wrapped action where the row truly doesn't exist (PGRST116), **When** the user submits a non-existent ID, **Then** the user sees "not found" and Sentry receives **no** event (avoiding noise on routine misses).
3. **Given** a wrapped P0 action (e.g. PayPal `captureAndGrantPackage`), **When** the action fails, **Then** Telegram receives a critical-severity alert in addition to the Sentry event.

---

### User Story 2 — Every wrapped action leaves an audit trail (Priority: P1)

When an admin grades a follow-up, archives a teacher, captures a PayPal payment, or any other mutating action, an `audit_log` row records who did what, on which entity, with what outcome. Auditors and operators can answer "who changed this and when" without parsing logs.

**Why this priority**: Audit trail is half of "loud failures" — without it, post-mortem investigation depends on log scrubbing. Every Phase 2 wrap adds an `audit_log` envelope row; this spec ensures the remaining 9 files inherit that property.

**Independent Test**: Wrap `addStudentToSession`, perform the action, then query `audit_log` filtered by `record_id` of the new booking. Confirm one row with `changed_by = actorId`, `table_name = 'bookings'`, `action = 'INSERT'`, and a `reason` containing the action name.

**Acceptance Scenarios**:

1. **Given** a successful wrapped action, **When** completed, **Then** `audit_log` contains one envelope row plus any pre-existing diff rows (no behaviour regression).
2. **Given** a failed wrapped action where `cause` is attached, **When** failure occurs, **Then** `audit_log` contains a row with `reason` containing "FAILED" + the cause's message.
3. **Given** a `UserError` thrown without `cause` (pure preflight/validation), **When** it surfaces, **Then** `audit_log` does **not** receive a FAILED row (avoid noise on routine validation).

---

### User Story 3 — Forms communicate failure states to users (Priority: P2)

When a server action returns `{ ok: false, error }`, the form rendering it displays the error to the user via the standard `<ActionFeedback>` component. Forms that currently render nothing on failure (silent UI fail) get the highest-impact wrap.

**Why this priority**: This is Phase 2c — closing the form-feedback gap is independent of the wrap work but completes the loud-failures principle from the user-visible side. Highest-impact forms only in this PR; full sweep is a follow-up series.

**Independent Test**: Pick a form using `useActionState` without `<ActionFeedback>`. Add `<ActionFeedback state={state} />` near the submit button. Force a failure path. Confirm the user sees the Arabic error message inline with the form (not in a console).

**Acceptance Scenarios**:

1. **Given** a form whose action returns `{ error }`, **When** submitted with a failure path, **Then** the error renders inline within 200 ms of the response.
2. **Given** a form whose action returns `{ ok: true, message }`, **When** successful, **Then** the success message renders briefly before the form clears or page revalidates.

---

### User Story 4 — CI prevents new silent-fail anti-patterns (Priority: P2)

When a developer adds a `.single()` call that destructures only `{ data: x }` (dropping `error`), the silent-fail tripwire catches it pre-commit and blocks the commit. The same hook already catches `?? []` / `?? null` / `.catch(() => {})`; Phase 2d extends it.

**Why this priority**: Wave-2 propagation across PRs 9–16 was caused by exactly this anti-pattern slipping in. The tripwire makes future drift structurally impossible.

**Independent Test**: Add a deliberate `const { data: x } = await supabase.from(...).single()` to a sample file (no `error` capture). Run `git commit`. Confirm the pre-commit hook blocks with a clear message naming the offending file:line.

**Acceptance Scenarios**:

1. **Given** new code with the `.single()` error-drop shape, **When** committing, **Then** the hook blocks and prints the file:line + the suggested fix (use `notFoundOrInfra`).
2. **Given** existing wrapped code that already uses `notFoundOrInfra`, **When** committing, **Then** the hook does not flag it.

---

### User Story 5 — Audit doc reflects production reality (Priority: P3)

When an operator or future contributor reads `docs/audit/no-silent-failures-2026-Q2.md`, every action's wrapped/deferred/dead-code status reflects what is actually on `main`. No more references to wraps that never happened, table names that don't exist, or actions that were dead-code-deleted.

**Why this priority**: 5+ audit-doc inaccuracies were caught and fixed during PRs 11–19 (drifted column names, inaccurate surface descriptions, phantom n8n emit, incorrect Tasks-ready labels). The doc was the source of truth for Phase 2 planning; if it stays stale, future phases inherit confusion.

**Independent Test**: Run a script that scans every `.ts` file under `src/app/admin/` and `src/lib/actions/` for `loudAction` adoption, then diffs against the audit doc's "Wrapped ✅" markers. Confirm zero discrepancies.

**Acceptance Scenarios**:

1. **Given** the audit doc post-merge, **When** scanned against current code, **Then** every action either appears in the doc with the correct status (Wrapped/Deferred/Dead-code-deleted) or is intentionally absent.
2. **Given** spec 005 listed as "Tasks-ready" in `specs/INDEX.md`, **When** it actually shipped via PR #238, **Then** running `npm run specs:index` regenerates the index showing it as "Shipped".

---

### Edge Cases

- **Multi-field return values that don't fit `loudAction`'s `Output: { message?: string }` constraint** — defer the wrap with explicit rationale + add a manual `audit_log` row + per-error-path `logError`. Already 3 deferrals in prior PRs (`joinAsObserver`, `getHomeworkAudioUrl`, `bulkGradeHomework`); 1–2 more expected (`generateSessionToken`, `toggleArchiveTeacher`).
- **Storage upload + DB update sequence** with potential orphan files (`saveProfilePhoto`-style). Wrap routes the error to Sentry via cause; a separate cleanup-on-fail PR handles the orphan. Not in scope here.
- **Stripe deferral** — `initiateEnrollmentCheckout` (P0) is shaped for Stripe but Stripe keys aren't live. Leave deferred per audit; will become live when API keys ship.
- **PayPal money double-write** — `captureAndGrantPackage` does PayPal capture → `student_packages.insert` → `deduct_package_session` RPC. A wrap must NOT change the order or fail-soft semantics; only the audit trail and `severity: critical` are added.
- **Per-item silent fails inside bulk loops** (already handled in PR 19). Pattern: `logError` per-item before `errors.push(...)`. No framework change needed.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST wrap every P0 and P1 mutating server action in the 9 target files with `loudAction` from `src/lib/actions/loud.ts`, OR explicitly defer with a documented reason in the audit doc.
- **FR-002**: System MUST attach `cause` to `UserError` when the throw wraps a Supabase / Daily.co / storage error, so the framework routes the underlying error to Sentry.
- **FR-003**: System MUST use `notFoundOrInfra` (exported from `loud.ts` post-PR-20) at every `.single()` call site that throws "not found" — distinguishing PGRST116 (silent passthrough) from real infrastructure errors (cause attached).
- **FR-004**: System MUST calibrate severity per action: `info` for routine writes, `warning` for destructive-expected, `critical` for money/security paths (PayPal, manual credit grants, role mutations).
- **FR-005**: System MUST preserve every existing public function signature (form callers must continue to work without changes).
- **FR-006**: System MUST write `audit_log` rows using the canonical `changed_by` column shape — no `actor_id` / `metadata` columns from older drift.
- **FR-007**: System MUST extend the silent-fail tripwire run from `.husky/pre-commit` (the only currently-configured CI hook for staged-file grep enforcement) to detect `\{\s*data:\s*\w+\s*\}\s*=\s*await\s+supabase\..+\.(single|maybeSingle)` shapes that drop the `error` variable. The pattern matches both `.single()` and `.maybeSingle()` per `contracts/tripwire-contract.md`.
- **FR-008**: System MUST add `<ActionFeedback>` to **exactly 3 forms** in this PR — the post-session-notes form (`teacher/sessions/[id]/post-session-form.tsx`), the PayPal checkout callback (`(public)/packages/paypal-checkout.tsx`), and the student-notes form (`teacher/students/[studentId]/notes-form.tsx`) — per `tasks.md` T024–T026. Full sweep of the remaining ~25 callers is deferred to a follow-up PR series.
- **FR-009**: System MUST update `docs/audit/no-silent-failures-2026-Q2.md` with `Wrapped ✅` markers and severity for every newly wrapped action; correct any pre-existing inaccuracies discovered during the sweep.
- **FR-010**: System MUST regenerate `specs/INDEX.md` to reflect spec 005's "Shipped" status (correcting "Tasks-ready" drift).
- **FR-011**: System MUST ensure `npx tsc --noEmit` passes on the entire wrapped surface; the `silent-fail tripwire` and `vitest run` CI checks pass on the merged commit.
- **FR-012**: System MUST keep deferral rationale visible — every deferred action carries a code comment explaining why the framework's `Output` constraint or other shape doesn't fit.

### Key Entities

- **Server action**: a `"use server"` exported function in `src/app/.../actions.ts` or `src/lib/actions/*.ts` that mutates DB or has external side-effects.
- **`loudAction` wrap**: the framework primitive at `src/lib/actions/loud.ts` that adds Sentry + Telegram + audit_log envelope to a handler.
- **`UserError`**: per-file class (or framework-exported equivalent) with `userError = true` flag the framework's catch block recognizes; supports `(msg, { cause })` constructor.
- **`audit_log` row**: a `changed_by` + `table_name` + `record_id` + `action` + `reason` insert that records every mutating call.
- **`<ActionFeedback>`**: a React component at `src/components/shared/action-feedback.tsx` that renders `{ ok, error?, message? }` results from `useActionState`.
- **Silent-fail tripwire**: a pre-commit grep hook that blocks anti-patterns from entering the codebase.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of P0 and P1 mutating server actions in the 9 target files are either `loudAction`-wrapped or explicitly deferred with a documented rationale by the time this spec's PR merges.
- **SC-002**: A grep run after merge — `git grep "{ data: \w*\s*}\s*=" src/app src/lib/actions` excluding `auth.getUser` calls — returns zero matches in wrapped handler bodies.
- **SC-003**: A grep run after merge — `git grep "throw new UserError" src/` followed by manual inspection — confirms every Supabase-error-following throw includes `{ cause: ... }`.
- **SC-004**: The CI tripwire blocks at least one synthetic test commit that introduces the `.single()` error-drop shape; verified by a deliberate failed-commit test in the PR.
- **SC-005**: The audit doc's count of "Wrapped ✅" actions matches the count of `loudAction<...>(...)` instances under `src/app` and `src/lib/actions/` (within ±2 for legitimately deferred items).
- **SC-006**: `specs/INDEX.md` shows spec 005 as "Shipped" (not "Tasks-ready") after `npm run specs:index` runs in the PR.
- **SC-007**: For at least one wrapped action, a unit test using a stubbed Supabase client that throws a synthetic Postgres error confirms (a) the user-facing return shape is `{ ok: false, error: <Arabic message> }`, (b) `Sentry.captureException` is called with the underlying error attached as `cause`, and (c) the call settles within 30 seconds. (Preview-env testing is deferred until Supabase Branching is live, per CLAUDE.md "Preview database isolation — known gap (P2)".)
- **SC-008**: For PayPal's `captureAndGrantPackage` (severity=critical), a unit test using a stubbed PayPal client + stubbed `deduct_package_session` RPC that throws confirms both a Sentry event AND a Telegram alert fire. No live PayPal sandbox capture is performed (PayPal sandbox is non-prod but `student_packages.insert` would still hit the shared Supabase project — same Preview-env gap).

---

## Assumptions

- The 9 target files have not been wrapped by an earlier PR. **Verified pre-spec**: `evaluations.ts` was found already wrapped (audit-doc drift); excluded. The remaining 9 are the actual unwrapped surface.
- `loudAction` framework post-PR-17 (UserError-with-cause) and post-PR-20 (`notFoundOrInfra` exported) is the canonical baseline. No framework changes are needed for this spec.
- The form-feedback work (Phase 2c, FR-008) lands the highest-impact forms only — full sweep of 28 callers is a separate, deferred PR series.
- The audit-doc regeneration is partial — corrects inaccuracies discovered during this sweep; full regeneration is post-Phase-2 cleanup.
- PayPal API keys are live in the relevant env (Vercel Production + Preview); the wrap can be smoke-tested against PayPal sandbox without operator intervention.
- The Stripe deferral on `initiateEnrollmentCheckout` is intentional and remains deferred until Stripe API keys ship.
- The pre-commit hook framework (Husky) is already configured for the silent-fail tripwire; FR-007 is a single-line grep extension, not a new hook system.
- Constitution Principle II (Loud Failures NON-NEGOTIABLE) directly authorizes this work — the `/speckit.plan` constitution gate is expected to PASS.
- All changes ship as a single PR (per operator's "one step" instruction in the prior plan); reviewer-caught issues fix in-PR before merge, no follow-up PRs.

---

## Dependencies

- **`loud.ts` framework** — must remain at PR 20+ shape (cause-aware, exports `notFoundOrInfra`).
- **Audit doc** at `docs/audit/no-silent-failures-2026-Q2.md` — read-only baseline; updated as part of FR-009.
- **`specs/INDEX.md` regeneration script** — `npm run specs:index` (per Spec-Kit Workflow in CLAUDE.md). FR-010.
- **Constitution** at `.specify/memory/constitution.md` Principle II — citable from `/speckit.plan`.
- **PayPal SDK** — server-side only (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`); no public client SDK changes.
- **Sentry** — DSN must be live in Vercel env (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`) for SC-007 / SC-008 to be testable.
- **Telegram** — `TG_BOT_TOKEN` + `TG_ADMIN_CHAT_ID` live for SC-008.

---

## Out of scope

- **Phase 2b — Domain-layer wraps** (`src/lib/domains/<domain>/`) — optional per audit doc §10; not in this spec.
- **Full form-feedback sweep** — only the highest-impact forms in this spec; remainder is a follow-up PR series.
- **Phase 3 — Session Modes / Majlis** — separate spec (007), starts after this one ships.
- **`audit_log` column reconciliation** — `actor_id` / `metadata` drift in `homework.ts` is a data-archeology task, separate spec/PR.
- **Stripe completion** — `initiateEnrollmentCheckout` stays deferred until Stripe keys ship.
- **Per-PR review pause workflow** — operator's explicit "one step" instruction overrides the prior anti-drift rule #5 (AskUserQuestion before P0-money). PayPal ships in this spec's PR.

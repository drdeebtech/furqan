# Feature Specification: Operational Debt Cleanup — Bad-List Batch

**Feature Branch**: `008-ops-debt-cleanup`
**Created**: 2026-05-12
**Status**: Draft
**Input**: User description: "Fix all 7 partial/runbook-only items from the 2026-05-12 audit (bad-list): Daily.co webhook activation, silent-fail audit_log migration, Sentry auto-resolve repair, K6 test user removal, Supabase MCP account switch, with verification that Supabase migrate workflow and preview-DB warning items are confirmed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Session records reflect reality without manual cleanup (Priority: P1)

The operator (admin) needs every completed teaching session to have an accurate `ended_at`, `duration_min`, and `status` recorded automatically, without a human-in-the-loop step or a cron-job backstop running hours later. Until this is true, post-session billing, evaluation triggers, and student progress totals can be hours-stale or contain implausible durations (e.g., the 18,630-minute incident flagged 2026-05-08).

**Why this priority**: This is the most visible operational debt on the list. Every other downstream automation (evaluations, billing, parent reports, follow-up reminders) depends on session records being trustworthy. Operators currently work around stale records by hand; that does not scale to 50,000 users.

**Independent Test**: A teacher and student join a Daily.co room, talk for any duration, and both leave. Within 60 seconds, the session record shows accurate `started_at`, `ended_at`, `status="completed"` (or `no_show` for misclicks), and the downstream `session.ended` event fires once. No cron job is needed to clean up.

**Acceptance Scenarios**:

1. **Given** a scheduled session with a Daily.co room, **When** the room is opened and both participants join, **Then** the session record is updated to `in_progress` and `started_at` is set within 60 seconds with no operator intervention.
2. **Given** a session that just ended, **When** the room closes, **Then** the session record is marked `completed` (if duration ≥ misclick threshold) or `no_show` (if duration < threshold), with `ended_at` and `duration_min` populated from the lifecycle event source-of-truth.
3. **Given** a duplicate lifecycle event arrives (network retry), **When** the second event is processed, **Then** no double-billing, no duplicate emitted events, and the record stays consistent.

---

### User Story 2 — Admin destructive actions are loud when they fail (Priority: P1)

When an admin performs a destructive action (user delete, package change, session cancel, etc.), the audit-trail insert that records the attempt must never fail silently. Today, many such writes use a fire-and-forget pattern that discards errors, so an operator can take an action believing it was logged when it was not. At 50,000 users this is a compliance and forensics gap.

**Why this priority**: This is the load-bearing primitive for admin accountability. CLAUDE.md's "No Silent Failures Policy" mandates that every `audit_log` write pipe failures through the central logger. Today, ~30 admin write sites violate this.

**Independent Test**: Force an `audit_log` insert to fail (e.g., revoke insert privilege temporarily on a staging table). Run an admin action. Verify that (a) the user-facing action completes, (b) the failure is captured by the central logger with the correct tag, and (c) the failure shows up in Sentry / operator alerting — instead of being silently dropped.

**Acceptance Scenarios**:

1. **Given** an admin performs a recordable destructive action, **When** the action succeeds but the audit-trail insert fails, **Then** the failure is recorded by the central logger with enough context (action name, target id, error) to reproduce and fix it.
2. **Given** the audit-trail insert succeeds, **When** the admin completes the action, **Then** no spurious error is logged — best-effort writes stay non-blocking on the happy path.
3. **Given** an admin runs the action and the primary write fails, **When** the action returns to the UI, **Then** the user sees a real failure message and no audit-log entry is created for a non-event.

---

### User Story 3 — Operators don't manually close Sentry issues on every fix-PR (Priority: P2)

When an engineer ships a PR with `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in the commit message and the build deploys to production, the corresponding Sentry issue must auto-close. Today this does not happen, so the operator has to manually close 1–3 Sentry issues per fix-PR.

**Why this priority**: This is pure recovered time. At ~30 fix-PRs/month × 2 minutes of manual closing per PR, it's ~1 hour/month of repetitive ops work. Not life-or-death, but it compounds.

**Independent Test**: Pick an open Sentry issue. Ship a PR with `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in the body. Wait for the production deploy. Confirm the Sentry issue auto-resolves without manual action.

**Acceptance Scenarios**:

1. **Given** a fix-PR includes a `Fixes <issue-id>` keyword in the commit message or body, **When** the PR merges and a production release is created, **Then** the Sentry issue moves to "Resolved in next release" automatically.
2. **Given** the production release is created with no `Fixes` keyword in any commit since the last release, **When** the release is processed by Sentry, **Then** no issues are inappropriately resolved.

---

### User Story 4 — Production user records contain only real users (Priority: P2)

The production `auth.users` and `profiles` tables must not contain 500 K6 load-test profile rows that were created during 2026-04 load testing and never cleaned up. These rows pollute admin user lists, can be matched cross-platform, and skew analytics.

**Why this priority**: Data hygiene gap, not a blocker. But it actively misleads any admin who scans the user list, and it inflates user counts in dashboards. Cheap to remove with a documented runbook.

**Independent Test**: Run a count query against `profiles` filtered to the K6 test-user email pattern. After cleanup, that count is zero. Spot-check 10 admin user-list rows; none are K6 test entries.

**Acceptance Scenarios**:

1. **Given** 500 K6 test user rows exist in `profiles` and `auth.users`, **When** the cleanup runbook executes, **Then** all 500 rows and their cascaded children (bookings, sessions, etc.) are removed, with a destructive-action audit entry recording the operator and timestamp.
2. **Given** the cleanup runs, **When** the operator inspects the admin user list, **Then** no K6 test profiles appear and the total active-user count drops by exactly 500.

---

### User Story 5 — Programmatic Supabase tooling targets the right project (Priority: P3)

The Supabase MCP client used during development sessions must authenticate as the account that owns the FURQAN production project (`alforqan.egy@gmail.com`), not as the operator's unrelated personal account. Until this is fixed, any MCP-driven verification (table inspect, log query, advisor check) silently targets the wrong project and returns misleading results.

**Why this priority**: Friction, not correctness. The MCP tools return *some* result, just not the FURQAN one — so it's easy to miss. The mitigation is a documented operator login step.

**Independent Test**: Invoke an MCP Supabase tool that lists projects. The FURQAN project ref `xyqscjnqfeusgrhmwjts` appears in the list. Verify against the documented owner email.

**Acceptance Scenarios**:

1. **Given** an operator starts a session, **When** they invoke a Supabase MCP tool, **Then** the tool resolves to the FURQAN project, not the operator's personal account.
2. **Given** the operator switches accounts, **When** they re-run any MCP Supabase tool, **Then** subsequent calls target the FURQAN project until the next account switch.

---

### Edge Cases

- **Daily.co event outside the ±15-min skew window** — accepted (no retry triggered) but recorded as `stale-event` and not applied. Already handled by the shipped webhook handler.
- **Daily.co unmappable `room_name`** — accepted, recorded as `unmapped-room`, surfaced via Sentry threshold alert at `>10/hour`. Already handled.
- **HMAC rotation overlap** — webhook handler accepts both current and previous secret if `DAILY_WEBHOOK_SECRET_PREVIOUS` is set. Already implemented.
- **Audit-log failure on best-effort write** — must not block the user-facing action; must surface to operator alerting. The fix is *additive logging*, not *return error to user*.
- **Sentry GitHub App org install fails for a transient reason** — operator falls back to manual `Sentry MCP update_issue` per the runbook. The runbook is the documented fallback.
- **K6 cleanup encounters orphaned foreign keys** — cascade-delete handles bookings, sessions, evaluations, follow-ups, messages. If a constraint fails, the runbook stops, logs the affected row, and asks the operator before continuing.
- **Supabase MCP token cached on the wrong account** — operator runs `supabase login` against the right account, then `supabase link --project-ref <FURQAN ref>`. Runbook covers both steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST record `started_at` on every teaching session when the underlying conferencing room reports its first lifecycle event, within 60 seconds of the event.
- **FR-002**: System MUST record `ended_at`, `duration_min`, and a terminal status (`completed`, `no_show`, or domain-preserved) on every teaching session when the conferencing room reports a session-end event, sourced from the room provider rather than a clock-side fallback.
- **FR-003**: System MUST treat duplicate lifecycle events idempotently — a second arrival MUST NOT mutate state, emit duplicate downstream events, or trigger duplicate billing.
- **FR-004**: System MUST reject lifecycle events whose signed payload does not verify against the active webhook secret, with a logged warning and a 4xx response. Rejection MUST NOT mutate any record.
- **FR-005**: System MUST capture every failed `audit_log` insert via the central logger with a stable tag, action name, target identifier, and the underlying error.
- **FR-006**: System MUST NOT block the user-facing action when an `audit_log` insert is best-effort and fails — the failure is captured and surfaced, the action completes.
- **FR-007**: Operators MUST be able to ship a fix-PR with a `Fixes <Sentry-issue-id>` keyword in the commit message and observe the Sentry issue auto-resolve once the production release is created.
- **FR-008**: The production user records MUST NOT include the load-test user accounts created during 2026-04 K6 runs (~500 rows, identified by email pattern).
- **FR-009**: Cleanup of load-test users MUST cascade through every foreign-keyed child table (bookings, sessions, evaluations, follow-ups, messages, notifications, audit_log) such that no orphaned rows remain.
- **FR-010**: Cleanup of load-test users MUST record a destructive-action audit entry with operator identity, timestamp, count of rows removed, and the originating runbook reference.
- **FR-011**: Programmatic Supabase tools invoked during operator sessions MUST resolve to the FURQAN production project, not any other project the operator's identity has access to.
- **FR-012**: Supabase migration apply MUST be driven by the in-repo workflow and MUST fail-fast on missing credentials rather than silently fall back to the legacy Branching integration.
- **FR-013**: Preview deployments MUST visibly warn the operator that they share the production database until full isolation is in place. The warning MUST be dismissable per session but visible by default.

### Key Entities

- **Session record**: Owns lifecycle timestamps (`started_at`, `ended_at`), duration, terminal status, and provenance pointers (event id, source). One row per teaching session.
- **Audit-log entry**: Records who-did-what-when for every admin destructive action. Best-effort write semantically — never blocks the underlying action, but must always surface failures.
- **Sentry issue**: External resource keyed by an issue identifier (`JAVASCRIPT-NEXTJS-E4-<N>`); referenced from commit messages and PR bodies to drive auto-resolution.
- **Load-test user**: A `profiles` + `auth.users` pair created during synthetic load testing, identified by a deterministic email pattern. Must not exist in production after cleanup.
- **Webhook secret**: Shared secret between the conferencing provider and the receiver, used to verify event payload integrity. Rotated via overlap window.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of completed teaching sessions have an `ended_at` populated within 60 seconds of the conferencing room closing, with no cron-job cleanup required.
- **SC-002**: 0 sessions in any rolling 30-day window have a recorded duration outside the plausible band of 0–180 minutes (the 18,630-minute class of bug never recurs).
- **SC-003**: 0 audit-log insert failures in any rolling 7-day window go unreported — every failure is queryable from the central logger by tag.
- **SC-004**: Every fix-PR that includes a `Fixes <Sentry-issue-id>` keyword and ships to production auto-resolves its referenced Sentry issue within 5 minutes of the production release, with operator manual-close action at 0%.
- **SC-005**: Production user count, after cleanup, drops by exactly 500 (the K6 cohort), and any subsequent admin user-list scan returns 0 entries matching the K6 email pattern.
- **SC-006**: Any Supabase MCP call made by an operator from a fresh session resolves to the FURQAN project on the first call, with no silent cross-account drift.

## Assumptions

- **Daily.co code path is already shipped** (per `src/app/api/webhooks/daily/route.ts` and `src/lib/daily/webhook-handler.ts`, with tests). The remaining gap is operational configuration only — webhook secret distribution + provider dashboard URL registration. Spec 007 already covered the design.
- **Supabase migrate workflow is operational** as of 2026-05-05 — `SUPABASE_DB_PASSWORD` is set in GitHub secrets, `.github/workflows/supabase-migrate.yml` is the source of truth. This item is folded into FR-012 for completeness but no new work is required.
- **Preview database isolation** beyond the warning banner is correctly deferred — it requires Supabase Pro, which the operator has declined. The spec only enforces FR-013 (warning banner remains visible by default), not full isolation.
- **Audit-log writes are best-effort by design** — they record an attempt; they do not gate the action. CLAUDE.md establishes this; the fix is to surface failures via `logError`, not to make them blocking.
- **Sentry GitHub App is installed at the user level today** and needs to be re-installed at the `drdeebtech` org level for `release.setCommits.auto` to enumerate commits correctly. Diagnosis already done in `docs/runbooks/sentry-auto-resolve-fix.md`.
- **Operator has access to the Daily.co dashboard** to configure the webhook URL and obtain the signing secret.
- **K6 test users are identified by a deterministic email pattern** documented in `docs/runbooks/k6-test-users-cleanup.md` — cleanup is a single-query scope, not a heuristic.

## Out of Scope

- **Full preview-deployment database isolation** (blocked on Supabase Pro upgrade — operator decision 2026-05-07; do not propose).
- **Supabase Branching** (same Pro-upgrade dependency).
- **Postgres aggregates for stats / Phase 7** (deferred indefinitely; Pro-upgrade dependency).
- **Silent-fail migration for non-audit-log write paths** — business-logic writes in `content/`, `services/`, `teacher/dashboard/` already use `{ error }` capture + `throw`. They are not part of this spec. Only the `audit_log` and `automation_logs` best-effort writes are in scope.
- **End-to-end Playwright write-flow coverage (Phase 2B)** — a separate workstream, not folded in here.
- **Stripe / WhatsApp / Google Calendar integrations** — blocked on operator credentials; not part of this batch.
- **Student session self-confirm / parent dashboard** — net-new product features; separate specs.

## Dependencies

- **Operator browser access** to: Sentry org settings, Daily.co dashboard, Vercel environment variables, Supabase dashboard (for K6 cascade-delete).
- **GitHub secrets write permission** for `DAILY_WEBHOOK_SECRET` (the only new secret introduced by this spec).
- **Production database access** for the K6 cleanup runbook (cascade-delete on `auth.users` requires service-role).
- **`docs/runbooks/sentry-auto-resolve-fix.md`** — already authored, executable.
- **`docs/runbooks/k6-test-users-cleanup.md`** — already authored, executable.
- **`docs/runbooks/supabase-mcp-account-switch.md`** — already authored, executable.

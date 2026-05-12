# Feature Specification: Daily.co webhooks as session-lifecycle source of truth

**Feature Branch**: `007-daily-webhooks`
**Created**: 2026-05-12
**Status**: Draft
**Input**: Wire Daily.co `meeting.started` and `meeting.ended` server-side webhooks into the FURQAN session lifecycle so the platform's `sessions.started_at` and `sessions.ended_at` reflect *actual call presence* rather than *page-visit heuristics*. Replaces the current `trackSessionEvent` page-join semantics, which never auto-clears or auto-ends and has produced 18,630-min durations on 30-min slots (Findings Backlog F1, currently band-aided by a 2x-planned cap migration).

## Clarifications

### Session 2026-05-12

- Q: Where should processed webhook event IDs be stored for idempotency? → A: New dedicated `daily_webhook_events` table with `UNIQUE(event_id)` + index on `received_at`; 7-day TTL via existing `audit-cleanup` daily cron. Reuses Postgres (the project's only durable store); no new infra needed.
- Q: How is a Daily.co room name mapped to a `sessions` row? → A: Additive `sessions.room_name` column (TEXT, indexed). Substring-matching the existing `sessions.room_url` is a hot-path write amplifier at 50k DAU (every webhook scans 300k+ rows). The migration backfills `room_name` from parsed `room_url` for existing rows.
- Q: How are parent notifications, package deduction, and n8n events moved off the webhook critical path? → A: Reuse the existing `emitEvent("session.ended", ...)` non-blocking fire-and-forget pattern from `src/lib/automation/emit.ts`. Webhook handler does only: HMAC verify → idempotency check → sessions update → bookings status flip → emitEvent. No new queue infra.
- Q: What if the operator rotates `DAILY_WEBHOOK_SECRET` mid-flight? → A: Receiver supports both the current and previous secret for 24 hours after rotation, gated by an env var `DAILY_WEBHOOK_SECRET_PREVIOUS` (optional). Eliminates the secret-rotation ops scramble; in-flight retries from the old secret still validate.
- Q: When manual `endSession` writes `ended_at` first and the Daily webhook then arrives, who wins on `actual_duration`? → A: Daily wins. FR-004/FR-005 mark Daily as canonical; FR-007 already covers reconciliation. Manual writes are advisory until the webhook supersedes them. The audit log records both touches so the divergence is auditable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Accurate billable duration on every completed session (Priority: P1)

When a teacher and a student finish their actual call in Daily.co — by either side leaving and the room emptying, or by Daily.co's idle timeout firing — the platform records the **real** call duration on the `sessions` row. The teacher's "completed" view shows the actual minutes spent, the package deduction debits one session, and the parent's post-session notification carries an honest time figure.

**Why this priority**: The current behavior is the single most embarrassing data-quality bug in the platform — session cards routinely show 18,630-minute durations for 30-minute lessons, which calls every other progress metric into doubt and breaks payouts/reporting downstream. Fixing this unblocks honest analytics, eval-discipline gating, parent reports, and any future revenue-per-session reporting.

**Independent Test**: A teacher and a student can join + leave a real Daily.co room; the `sessions` row reaches `ended_at = <Daily's ended timestamp>` within seconds, the booking flips to `completed`, and the duration shown on `/teacher/sessions/[uuid]` matches wall-clock reality to within 10 seconds.

**Acceptance Scenarios**:

1. **Given** a confirmed booking whose Daily room exists, **When** both participants leave the room and Daily fires `meeting.ended`, **Then** within 10 seconds the corresponding `sessions` row has `ended_at` populated, `actual_duration` matches Daily's reported minutes, and the booking's `status` flipped to `completed`.
2. **Given** a confirmed booking whose Daily room exists, **When** the first participant joins and Daily fires `meeting.started`, **Then** within 10 seconds the corresponding `sessions` row has `started_at` populated with Daily's timestamp.
3. **Given** an existing session row whose `started_at` was set by the old page-visit handler hours before Daily reports `meeting.started`, **When** the Daily webhook arrives, **Then** the system overwrites `started_at` with Daily's timestamp (Daily is canonical, page-visit is advisory).
4. **Given** a `meeting.ended` event arrives for a session whose `ended_at` is already set (manual `endSession` ran first), **When** the webhook handler processes it, **Then** the row's `ended_at` and `actual_duration` are updated to Daily's values without erroring, and the audit log records both touches.

---

### User Story 2 — Operator confidence under burst load (Priority: P1)

When 200 concurrent FURQAN sessions all end inside the same 5-minute window — the realistic peak when Friday-evening hifz slots wrap up — every webhook lands, every session row updates, and zero events are dropped. The platform's webhook receiver is fast enough to acknowledge each event within Daily.co's retry budget and pushes downstream work (parent reports, package deduction, n8n event emission) off the critical path.

**Why this priority**: FURQAN is sized for 50,000 users (CLAUDE.md Scale Target Rule). Even at 1% concurrent-end rate, that's 500 webhooks in the same minute. A receiver that does synchronous notifications on the hot path will queue and miss Daily's retry window, causing some sessions to *never* close. This is the difference between "this works in dev" and "this works at production scale."

**Independent Test**: Send 200 simulated Daily.co webhook events at the receiver in 60 seconds (load test); confirm 100% are persisted, all return 200 within Daily's retry budget, and downstream notification dispatch happens asynchronously without blocking the receiver.

**Acceptance Scenarios**:

1. **Given** 200 simultaneous `meeting.ended` events for distinct sessions, **When** they arrive at the webhook endpoint in a 60-second window, **Then** all 200 sessions reach `ended_at` populated within 90 seconds total, and no event is dropped.
2. **Given** an inbound webhook for a session whose downstream parent-notification will take 2 seconds to dispatch, **When** the webhook handler runs, **Then** the handler returns 200 to Daily in under 500ms while the notification is queued for asynchronous processing.

---

### User Story 3 — Idempotent webhook receipt for retried events (Priority: P1)

Daily.co retries a webhook delivery if the receiver doesn't 2xx within their timeout. When the same event ID arrives twice (or more), the platform recognizes the duplicate and applies the state change exactly once. No double-completion, no double package-deduction, no second parent notification.

**Why this priority**: Webhook duplicates are a fact of life at network scale, not an edge case. Without idempotency, every retried event causes a real side effect — and FURQAN's hot tables include `student_packages` (deducting sessions) and `notifications` (parents getting two copies of the same report). At 50k DAU, even a 0.1% retry rate is hundreds of duplicate writes per day.

**Independent Test**: Send the same Daily.co webhook payload twice to the endpoint within 5 seconds; confirm the session's `ended_at` is set exactly once, the package is deducted exactly once, and exactly one parent notification is recorded.

**Acceptance Scenarios**:

1. **Given** an inbound `meeting.ended` event with a previously-seen event ID, **When** the receiver processes it, **Then** the database state is unchanged from the first delivery, no duplicate notification is sent, and the receiver returns 200 OK.
2. **Given** an inbound event whose signature does not validate against the configured HMAC secret, **When** the receiver processes it, **Then** the request is rejected with 401, the payload is NOT inspected for session/booking IDs, and a Sentry warning is logged.

---

### User Story 4 — Teacher's "End session" button still works as a confirming touch (Priority: P2)

When a teacher clicks "End session" on `/teacher/sessions/[uuid]` after the room has actually emptied but before Daily's webhook lands (or in the rare case Daily's webhook is delayed for minutes), the button succeeds and ends the session. The teacher never sees "session already ended" or any other confusing error. If the Daily webhook later arrives, it reconciles the row's `ended_at` to Daily's truth without surfacing a UI error.

**Why this priority**: Teachers shouldn't have to know that webhooks exist. The existing button must remain a viable manual fallback, but its semantics now mean "confirm the call is over" not "decide the call is over."

**Independent Test**: A teacher clicks "End session" on a session whose Daily webhook has not yet arrived; the session row's `ended_at` is set to the click time; when the Daily webhook later arrives, the row's `ended_at` is updated to Daily's timestamp without throwing, and the audit log records both the manual end and the webhook reconciliation.

**Acceptance Scenarios**:

1. **Given** a confirmed booking whose session is still active (no `ended_at`), **When** the teacher clicks "End session" and Daily's webhook has not arrived, **Then** the manual handler sets `ended_at` to the click timestamp and returns success.
2. **Given** a session whose `ended_at` was set by the manual handler, **When** Daily's `meeting.ended` webhook later arrives, **Then** the row's `ended_at` is updated to Daily's timestamp, the audit log records both events, and no UI error is shown to anyone.

---

### Edge Cases

- **Daily.co secret rotation**: when the operator rotates `DAILY_WEBHOOK_SECRET`, in-flight retries signed with the old secret are rejected; the system must surface this to ops within 5 minutes (via Sentry warning rate) so the operator can confirm the rotation completed.
- **Room → session mapping fails**: a webhook arrives for a Daily room name that no `sessions` row references (e.g. a manually-created room or a row that was deleted). The handler logs and 200s — Daily must not retry, but ops must see this as a signal.
- **Race between manual `endSession` and webhook**: both fire within 5 seconds. The session row's `ended_at` is set deterministically (Daily wins on `actual_duration`; whoever wrote first holds `ended_at` until the other touch reconciles).
- **Webhook arrives after manual `endSession` set a different student/teacher pairing wrong**: the webhook does NOT change `bookings.status` if `endSession` already flipped it; otherwise it does flip it.
- **Idle timeout vs. participant-leave**: Daily's `meeting.ended` fires either way. The platform makes no distinction — both produce a `completed` booking.
- **No participants ever joined**: Daily never fires `meeting.started`. The platform's existing no-show flow (manual `markNoShow`) remains the only path that closes such bookings; this feature is silent on no-shows.
- **Sessions older than 14 days with no Daily room**: the handler skips them (out-of-scope, predate the room-bound model).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST verify every inbound Daily.co webhook payload against the configured shared-secret HMAC signature before reading any field from the body. Verification MUST attempt the current `DAILY_WEBHOOK_SECRET` first, then — if an optional `DAILY_WEBHOOK_SECRET_PREVIOUS` env var is set — the previous secret. The previous-secret path MUST be removable by clearing the env var after a 24-hour overlap window. Failed verification under both secrets MUST return 401 and MUST NOT touch the database.
- **FR-002**: System MUST maintain a record of every processed Daily.co event ID for at least 7 days in a dedicated `daily_webhook_events` table with `UNIQUE(event_id)` and an index on `received_at`; the existing `audit-cleanup` daily cron MUST be extended to purge rows older than 7 days. Duplicate event IDs MUST be rejected idempotently — returning 200 to Daily without re-applying side effects.
- **FR-003**: System MUST map an inbound Daily.co room name to exactly one `sessions` row via the `sessions.room_name` column (added as an additive migration, indexed, backfilled from existing `room_url` values). If the room corresponds to no known session, the system MUST 200 the response (Daily must not retry) and emit an operator-visible signal (Sentry warning).
- **FR-004**: On `meeting.started`, system MUST set `sessions.started_at` to Daily's reported timestamp, overwriting any prior value (Daily is canonical).
- **FR-005**: On `meeting.ended`, system MUST set `sessions.ended_at` to Daily's reported timestamp, set `sessions.actual_duration` to the duration Daily reports, and — if the corresponding `bookings.status` is `confirmed` — flip it to `completed`. If the booking is already `completed`, system MUST leave the status unchanged but still update `ended_at` and `actual_duration`.
- **FR-006**: Webhook receiver MUST acknowledge each event with a 2xx response within 500ms (P99). The handler's hot path MUST be limited to: HMAC verification → idempotency check → `sessions` row update → `bookings.status` flip → fire-and-forget `emitEvent("session.ended", ...)`. All other downstream side effects (parent notifications, package-deduction confirmation, n8n routing) MUST flow through the existing `emitEvent` pattern in `src/lib/automation/emit.ts` and execute off the request path.
- **FR-007**: System MUST treat the manual `endSession` server action as idempotent against the webhook: if the webhook has already set `ended_at`, the manual end is a no-op success (not an error). If the manual end has already set `ended_at`, an arriving webhook reconciles `ended_at` and `actual_duration` to Daily's values without surfacing an error to the teacher.
- **FR-008**: Webhook receiver MUST log every accepted event (event ID, room, session ID, action taken) to `audit_log` for traceability. Failed verifications and unmappable rooms MUST be logged with `logError` at `warning` severity per the project's silent-failure policy.
- **FR-009**: System MUST tolerate webhook bursts of up to 500 events in a 60-second window without dropping events or exceeding 500ms P99 acknowledgement latency. Receiver MUST NOT perform per-event synchronous Supabase queries that scale linearly with payload size.
- **FR-010**: System MUST surface webhook health to operators: receiver count, acknowledge latency P99, failed-verification rate, and unmappable-room rate. Acceptable channel: Telegram alerts on threshold breach (failed-verification > 5/min OR unmappable-room > 10/hour).
- **FR-011**: After the webhook handler is live and verified, the existing page-visit-based `trackSessionEvent()` writes to `sessions.started_at` MUST be removed. Page-visit can still drive UI presence ("teacher has joined"), but it MUST NOT touch the `sessions` row's lifecycle columns.

### Key Entities

- **Daily.co webhook event**: a server-to-server message from Daily.co carrying an event type (`meeting.started`/`meeting.ended`), a unique event ID, an HMAC signature, and a payload with `room.name`, `start_time`, `end_time`, `duration` (for `meeting.ended`).
- **`sessions` row**: the FURQAN-internal record of a single class-session occurrence. Owned by the bookings/sessions domain. Existing columns `started_at`, `ended_at`, `actual_duration`, `room_url` all stay; webhook becomes a new write path with higher canonical priority than the page-visit path. **New column**: `room_name` (TEXT, indexed, additive migration; backfilled from parsed `room_url` for existing rows) — the lookup key for webhook → session mapping. Daily wins on `actual_duration` and `ended_at` if both manual `endSession` and the webhook touch the same row.
- **`daily_webhook_events` (new)**: idempotency log. Columns: `event_id` (TEXT PRIMARY KEY), `received_at` (TIMESTAMPTZ, index for cleanup), `event_type` (TEXT), `room_name` (TEXT nullable), `session_id` (UUID nullable, FK to sessions). 7-day retention via `audit-cleanup` cron extension.
- **Audit log entry**: existing `audit_log` table. New action codes: `session.webhook.started`, `session.webhook.ended`, `session.webhook.duplicate`, `session.webhook.unmapped`, `session.webhook.reconciled` (when webhook overwrites a manual end).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 99% of completed sessions in production over a 30-day window post-launch, the recorded `actual_duration` matches the wall-clock duration of the actual call within ±60 seconds.
- **SC-002**: Zero session rows in production have an `actual_duration` greater than 2× the booking's `duration_min`. (The 2x-cap migration's defensive guard becomes redundant; it can be removed in a future cleanup.)
- **SC-003**: Webhook receiver P99 acknowledgement latency under 500ms during normal load and under 1s during simulated burst of 200 events in 60 seconds.
- **SC-004**: 100% of duplicate Daily.co event deliveries (same event ID) are recognised and result in zero duplicate side effects (no double-deduction, no double-notification).
- **SC-005**: Operator can detect and react to any cluster of webhook failures (HMAC mismatch, unmappable room) within 5 minutes of onset, via existing Telegram alerts.
- **SC-006**: After 14 days of live webhook handling, the page-visit-based `sessions.started_at` write path is removed and no regression in session-row correctness is detected via a comparison check against Daily's API.

## Assumptions

- Daily.co's webhook delivery is at-least-once with retries on 4xx/5xx within their published budget; we don't need our own retry queue.
- Daily.co exposes a shared-secret HMAC for webhook authentication. (Confirmed by Daily docs; secret will be stored as `DAILY_WEBHOOK_SECRET` in Vercel env.)
- The additive `sessions.room_name` column will be populated for new rows by `confirm_booking_with_session()` (which already calls `createRoom`); existing rows backfill via the same migration that adds the column. Without this column, substring-matching `room_url` at 50k DAU would be a 250k-reads/day write amplifier (CLAUDE.md Scale Target Rule).
- The existing audit-log infrastructure (`src/lib/notifications/parent.ts` notification flow + `loudAction` audit metadata) can absorb the new action codes without schema changes.
- n8n is the right destination for asynchronous side-effects (parent notification, package deduction confirmation) per the existing event-emission pattern (`src/lib/automation/emit.ts`).
- Daily.co's webhook payload's `duration` field is in seconds (per Daily docs); the platform converts to minutes for `sessions.actual_duration` (which is stored as integer minutes today).
- The platform is on Vercel Pro per the 2026-05-05 upgrade — function timeout headroom (60s+) is available; we do not need an Edge runtime workaround.
- Out of scope for v1: recording-event webhooks (`recording.started`/`recording.ready`) — separate feature, will reuse the same receiver shape if pursued.
- Out of scope for v1: backfilling historical sessions whose `actual_duration` is currently capped/wrong. Historical data stays as-is; only forward sessions get accurate durations.

## Dependencies

- Operator action: configure `DAILY_WEBHOOK_SECRET` in Vercel env (Production + Preview).
- Operator action: in the Daily.co dashboard, register the production webhook URL (`https://www.furqan.today/api/webhooks/daily`) and subscribe to `meeting.started` + `meeting.ended` events.
- ADR-0004 booking-lifecycle orchestrator (already shipped) — this feature reuses the `confirmBooking` → `confirm_booking_with_session` atomic flow's downstream session row.
- Existing `emitEvent("session.ended", ...)` shape — webhook handler emits the same event so n8n consumers don't change.

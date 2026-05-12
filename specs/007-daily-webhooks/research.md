# Phase 0 Research: Daily.co webhooks

## Decision 1: Webhook payload shape

**Decision**: Use Daily.co's documented v1 webhook payload for `meeting.started` and `meeting.ended`. The receiver parses:

```jsonc
{
  "id": "evt_XYZ123",                    // unique event ID for idempotency
  "type": "meeting.ended",
  "room": { "name": "furqan-abc123" },   // primary key for sessions lookup
  "start_time": 1715500800,              // epoch seconds (meeting.started only)
  "end_time": 1715502600,                // epoch seconds (meeting.ended only)
  "duration": 1800                       // seconds (meeting.ended only)
}
```

**Rationale**: Matches Daily's published webhook reference; `id` is documented stable per event; `room.name` is what `createRoom` returns in `src/lib/daily.ts` today.

**Alternatives considered**:
- Subscribing to `participant.joined`/`participant.left` instead of `meeting.*`: rejected — participant-level events fire 2N times per session (join + leave for each side), tripling webhook load with no extra signal we use.
- Polling Daily's REST API for finished meetings: rejected — 5-minute poll interval adds 5 minutes of stale state to every dashboard; webhooks are real-time.

## Decision 2: HMAC verification

**Decision**: Verify `X-Webhook-Signature` header against `HMAC-SHA256(secret, raw_body).hex()` using Node's `crypto.timingSafeEqual` for constant-time comparison. Read the **raw** body (not the parsed JSON) so signature stays valid regardless of JSON whitespace/key order.

**Rationale**: Constant-time comparison prevents timing-side-channel secret extraction. Raw-body verification is the standard webhook hardening pattern (Stripe, GitHub all do this).

**Alternatives considered**:
- IP allowlisting Daily's webhook source IPs: rejected — Daily uses dynamic infrastructure (AWS); IP allowlist would break on every provider IP rotation.
- mTLS: rejected — Daily doesn't expose mTLS; not worth the complexity for our threat model.

## Decision 3: Idempotency strategy

**Decision**: `daily_webhook_events(event_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT now(), ...)` with `INSERT ... ON CONFLICT DO NOTHING RETURNING event_id`. If the INSERT returns a row, we're the first to process; if it returns zero rows, it's a duplicate — 200 the response without re-applying side effects.

**Rationale**: Atomic at the database level — no race window between "check" and "set." Postgres native; no Redis dependency. PK lookup is O(log n).

**Alternatives considered**:
- Redis SETNX with TTL: rejected — adds Redis as a hard dependency for a write that already touches Postgres; one fewer system in the critical path matters.
- In-memory cache with TTL: rejected — multi-instance Vercel functions don't share memory; misses defeat idempotency.

## Decision 4: Room name capture

**Decision**: Extend `createRoom` in `src/lib/daily.ts` to return both `url` and `name`, and persist `name` to `sessions.room_name` via the `confirm_booking_with_session` SQL function. For existing rows, the migration backfills `room_name` by parsing the path component of `room_url` (Daily room URLs are `https://furqan.daily.co/<name>`).

**Rationale**: `room_name` is what Daily's webhook payload sends; storing it directly is O(1) lookup vs O(n) substring match on `room_url`.

**Alternatives considered**:
- Computing `room_name` from `room_url` on every webhook: rejected per 50k-scale rule — 250k substring scans/day vs 250k indexed lookups/day is a 100×+ cost difference at peak.
- Storing a separate `room_id` column instead of `room_name`: rejected — Daily's webhook payload returns `room.name`, not `room.id`. Match what the wire format gives us.

## Decision 5: Burst handling on Vercel Node runtime

**Decision**: No special queueing layer. Vercel's Node runtime spawns up to 1000 concurrent function instances per region; 500 events in 60s averages to 8 events/sec, well under the concurrency ceiling. Each handler completes in <50ms compute + ≤200ms total DB time → 1000-concurrent capacity easily absorbs the burst.

**Rationale**: Adding a queue (SQS, Vercel Queues, etc.) before the receiver would add latency to a path already meeting the budget. YAGNI.

**Alternatives considered**:
- Vercel Queues for buffering: rejected — adds ~50ms per event, no real backpressure benefit at this volume.
- Edge runtime for receiver: rejected — Node crypto required for HMAC, and Edge has limited DB connection pooling. Node runtime on Pro plan has 60s timeout headroom, more than enough.

## Decision 6: Critical-path SQL function shape

**Decision**: New SQL function `end_session_from_webhook(p_session_id, p_ended_at, p_duration_min, p_duration_seconds, p_event_id, p_event_type, p_room_name, p_payload_json)` that atomically:

1. INSERTs `(event_id, event_type, ...)` into `daily_webhook_events` with `ON CONFLICT DO NOTHING` (returns NULL on duplicate → function short-circuits with no-op).
2. Captures prior state (`sessions.ended_at`, `sessions.started_at`, `bookings.status`) for branch decisions + audit metadata.
3. **Retroactive `started_at` fill** *(Clarify session 2)*: if `sessions.started_at IS NULL`, computes `started_at = p_ended_at - make_interval(secs => p_duration_seconds)`. Daily's `end_time - duration` is authoritative — no second roundtrip waiting on a `meeting.started` that may never arrive.
4. UPDATEs `sessions SET ended_at, actual_duration, started_at` (Daily-canonical; `started_at` only when previously null, never overwriting a real prior value).
5. **Branches on (prior_booking_status × duration)** *(Clarify session 2)*:
   - `confirmed + duration >= 300s` → flip booking to `completed`, audit action `session.webhook.ended` (or `session.webhook.reconciled` if manual end ran first).
   - `confirmed + duration < 300s` → flip booking to `no_show` (misclick filter at 50k DAU), audit action `session.webhook.misclick_filtered`.
   - `cancelled` or `no_show` → **booking status preserved** (booking domain owns these decisions), audit action `session.webhook.ended_on_cancelled`.
   - `completed` (manual end ran first) → no flip, audit action `session.webhook.reconciled`.
6. INSERTs `audit_log` row with the branch's chosen action + structured metadata (`prior_ended_at`, `prior_started_at`, `prior_booking_status`, `started_at_filled`, `status_outcome`).
7. Returns `(booking_id, student_id, teacher_id, is_duplicate, is_reconcile, status_outcome)` so the route adapter can `emitEvent("session.ended", "session", session_id, { booking_id, student_id, teacher_id, source: "daily-webhook", status_outcome })`.

Mirror function `start_session_from_webhook(p_session_id, p_started_at, p_event_id)` for the simpler `meeting.started` case.

**Rationale**: Matches ADR-0004 atomic-critical-path pattern (`confirm_booking_with_session`, `deduct_package_session`). Eliminates partial-state failure modes (sessions updated but bookings stale, or vice versa). The 4-branch booking-status logic + retroactive `started_at` fill encode FR-005's full shape from Clarify session 2 — implementer reads SQL, not prose, so the function MUST carry the behavior.

**The 5-minute misclick threshold (300s)** is a "save the operator from themselves" decision: at 50k DAU, a teacher accidentally joining a room for 15 seconds would otherwise debit the student's package + fire a parent report saying "session: 15 seconds." Filter at the protocol boundary (SQL function), not in application code — a misclick can't even reach the dashboards.

**The cancelled-booking guard** preserves booking-domain ownership: cancellation decisions belong to the user who clicked cancel, not to Daily.co's event stream. Sessions row updates honestly for audit, booking status stays user-owned.

**Alternatives considered**:
- Server-action choreography (sequential client calls): rejected per Constitution Principle III.
- Trigger-based reconciliation on `sessions` table: rejected — triggers run on every UPDATE regardless of source; harder to reason about + harder to test.
- Encoding the threshold in TypeScript at the route adapter: rejected — leaves a gap where a future direct caller of the SQL function bypasses the filter. Boundary lives at the SQL layer.

## Decision 7: Post-commit event emission

**Decision** *(updated by Clarify session 3, Q1)*: After the SQL function commits, the route adapter branches on the returned `status_outcome` to pick the correct event:

| `status_outcome` | Event emitted | Payload extras |
|---|---|---|
| `completed` | `session.ended` | `source: "daily-webhook"` |
| `reconciled` | `session.ended` | `source: "daily-webhook", was_reconciled: true` |
| `no_show` (misclick filter) | `session.no_show` | `source: "daily-webhook", reason: "misclick-filter", duration_seconds` |
| `preserved` (cancelled/no_show booking) | (none) | — |
| `duplicate` | (none) | — |

**Rationale**: Reuses existing `WEBHOOK_ROUTES["session.ended"]` and `WEBHOOK_ROUTES["session.no_show"]` n8n callbacks — zero new workflows needed. Critically, the misclick branch routes through `session.no_show` because:

1. **The existing `session.no_show` n8n consumer already has gentler parent copy** ("we noticed the call didn't happen; here are rescheduling options") — emitting `session.ended` for a 15-second misclick would fire a "session report: 0 minutes" parent SMS, which is exactly the failure Q3 of Clarify session 2 was designed to prevent.
2. **`deduct_package_session` is wired to `session.ended` only**, so emitting `session.no_show` preserves the student's package by default — no special-case code in the deduction path.
3. **Booking-domain ownership** (Clarify session 2 Q2): the `preserved` outcome (cancelled/no_show booking) emits nothing, because the booking-domain has already issued its own events for that state. A stray Daily event MUST NOT re-trigger downstream consumers that the user explicitly cancelled.

**Alternatives considered**:
- Always emit `session.ended` and gate downstream on a new `status_outcome` field: rejected — pushes filtering logic into 5+ n8n workflows; high coordination cost and easy to forget in a new consumer.
- New event type `session.webhook.ended` distinct from `session.ended`: rejected — doubles every n8n consumer's wiring; the `source` field captures the only meaningful distinction.
- New event type `session.misclick` for the no_show branch: rejected — invents a parallel workflow + new parent-report template for a case the existing `session.no_show` consumer handles correctly.

## Decision 8: Manual `endSession` reconciliation

**Decision**: Update `endSession` in `src/app/teacher/dashboard/actions.ts` so that the SQL UPDATE adds `WHERE ended_at IS NULL` as a guard. If the webhook already fired and set `ended_at`, the UPDATE matches zero rows — the action returns a success state ("Session already ended by Daily") without throwing. The audit log records the manual attempt with action `session.manual_end_post_webhook`.

**Rationale**: Teacher UX stays smooth (no error toast) while the audit trail captures the now-noop attempt. Matches Constitution Principle II — outcome is visible (the success state), the operator sees the attempt in audit.

**Alternatives considered**:
- Hard error "session already ended": rejected — surfaces an internal race to the teacher who did nothing wrong.
- Silent overwrite if manual end fires first, webhook overwrites later: this IS what happens (webhook is canonical per FR-004/-005); the audit log records both touches per Decision 6.

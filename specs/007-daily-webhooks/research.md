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

**Decision**: New SQL function `end_session_from_webhook(p_session_id uuid, p_ended_at timestamptz, p_duration_min int, p_event_id text)` that atomically:

1. INSERTs `(event_id, event_type, ...)` into `daily_webhook_events` with `ON CONFLICT DO NOTHING` (returns NULL on duplicate → function short-circuits with no-op).
2. UPDATEs `sessions SET ended_at=$2, actual_duration=$3 WHERE id=$1` (always Daily-canonical).
3. UPDATEs `bookings SET status='completed' WHERE id=(SELECT booking_id FROM sessions WHERE id=$1) AND status='confirmed'` (no-op if already completed or cancelled).
4. INSERTs `audit_log` row with action `session.webhook.ended` or `session.webhook.reconciled` (if `sessions.ended_at` was already non-null before this call).
5. Returns the booking_id so the route adapter can `emitEvent("session.ended", "session", session_id, { booking_id, student_id, teacher_id })`.

Mirror function `start_session_from_webhook(p_session_id, p_started_at, p_event_id)` for the simpler `meeting.started` case.

**Rationale**: Matches ADR-0004 atomic-critical-path pattern (`confirm_booking_with_session`, `deduct_package_session`). Eliminates partial-state failure modes (sessions updated but bookings stale, or vice versa).

**Alternatives considered**:
- Server-action choreography (sequential client calls): rejected per Constitution Principle III.
- Trigger-based reconciliation on `sessions` table: rejected — triggers run on every UPDATE regardless of source; harder to reason about + harder to test.

## Decision 7: Post-commit event emission

**Decision**: After the SQL function commits, the route adapter calls `emitEvent("session.ended", "session", sessionId, { booking_id, student_id, teacher_id, source: "daily-webhook" })`. This fires the existing `WEBHOOK_ROUTES["session.ended"]` n8n callback, which downstream fans out parent-report generation, package deduction confirmation, and any other registered consumers.

**Rationale**: Zero new n8n workflows needed; the `source` discriminator lets n8n branches treat webhook-triggered ends differently from manual ones if needed.

**Alternatives considered**:
- New event type `session.webhook.ended` distinct from `session.ended`: rejected — doubles every n8n consumer's wiring; the source field captures the only meaningful distinction.

## Decision 8: Manual `endSession` reconciliation

**Decision**: Update `endSession` in `src/app/teacher/dashboard/actions.ts` so that the SQL UPDATE adds `WHERE ended_at IS NULL` as a guard. If the webhook already fired and set `ended_at`, the UPDATE matches zero rows — the action returns a success state ("Session already ended by Daily") without throwing. The audit log records the manual attempt with action `session.manual_end_post_webhook`.

**Rationale**: Teacher UX stays smooth (no error toast) while the audit trail captures the now-noop attempt. Matches Constitution Principle II — outcome is visible (the success state), the operator sees the attempt in audit.

**Alternatives considered**:
- Hard error "session already ended": rejected — surfaces an internal race to the teacher who did nothing wrong.
- Silent overwrite if manual end fires first, webhook overwrites later: this IS what happens (webhook is canonical per FR-004/-005); the audit log records both touches per Decision 6.

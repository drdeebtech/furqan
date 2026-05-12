# Contract: Daily.co webhook payload

Endpoint we expose: `POST https://www.furqan.today/api/webhooks/daily`

## Headers Daily.co sends

| Header | Value | Use |
|---|---|---|
| `Content-Type` | `application/json` | parse hint |
| `X-Webhook-Signature` | `HMAC-SHA256(secret, raw_body).hex()` | authenticity |
| `X-Webhook-Timestamp` | epoch ms (optional, Daily's anti-replay header) | optional ≤5min skew check |
| `User-Agent` | `Daily-Webhook/1.0` (approximate) | logging hint |

## Request body — `meeting.started`

```jsonc
{
  "id": "evt_8f3a2c1d9b0e",          // unique event ID — idempotency key
  "type": "meeting.started",
  "version": "1",
  "timestamp": 1715500800000,         // epoch ms when Daily emitted the event
  "room": {
    "name": "furqan-abc123",          // matches sessions.room_name
    "id": "room_xyz",                 // Daily-internal; not used by us
    "domain_name": "furqan.daily.co"
  },
  "data": {
    "start_time": 1715500800,         // epoch seconds when meeting started
    "session_id": "daily_sess_..."    // Daily's session ID; not used by us
  }
}
```

## Request body — `meeting.ended`

```jsonc
{
  "id": "evt_8f3a2c1d9b0e",
  "type": "meeting.ended",
  "version": "1",
  "timestamp": 1715502600000,
  "room": {
    "name": "furqan-abc123",
    "id": "room_xyz",
    "domain_name": "furqan.daily.co"
  },
  "data": {
    "start_time": 1715500800,
    "end_time": 1715502600,
    "duration": 1800,                 // seconds
    "max_participants": 2,
    "total_participants": 2
  }
}
```

## Our response

| Scenario | HTTP | Body |
|---|---|---|
| Valid signature + recognized room + new event + booking `confirmed` + duration ≥ 5min | `200` | `{ "ok": true, "session_id": "...", "applied": true, "status_outcome": "completed" }` |
| Valid signature + recognized room + new event + booking `confirmed` + duration < 5min | `200` | `{ "ok": true, "session_id": "...", "applied": true, "status_outcome": "no_show", "reason": "misclick-filter" }` |
| Valid signature + recognized room + new event + booking `cancelled` or `no_show` | `200` | `{ "ok": true, "session_id": "...", "applied": "session-only", "status_outcome": "preserved", "reason": "booking-status-preserved" }` |
| Valid signature + recognized room + new event + booking already `completed` (manual end ran first) | `200` | `{ "ok": true, "session_id": "...", "applied": true, "status_outcome": "completed", "reason": "reconciled" }` |
| Valid signature + recognized room + duplicate event | `200` | `{ "ok": true, "session_id": "...", "applied": false, "reason": "duplicate" }` |
| Valid signature + unmappable room | `200` | `{ "ok": true, "applied": false, "reason": "no-matching-session" }` |
| Valid signature + payload timestamp outside ±15 min skew window | `200` | `{ "ok": true, "applied": false, "reason": "stale-event" }` |
| Invalid signature (both current + previous fail) | `401` | `{ "error": "invalid_signature" }` |
| Malformed JSON body | `400` | `{ "error": "invalid_payload" }` |
| Unsupported event type (anything but `meeting.started`/`meeting.ended`) | `200` | `{ "ok": true, "applied": false, "reason": "unsupported-event-type" }` |
| Internal error (DB connection lost, etc.) | `500` | `{ "error": "internal_error" }` → Daily retries |

**200 vs error semantics**: Daily retries on non-2xx within their published budget. We return 200 for "we accepted and processed (or correctly no-op'd)" — anything actionable from the operator side. We return 5xx only for genuinely transient failures where retry would help.

## Verification pseudocode

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

// Route handler:
const raw = await req.text();
const sig = req.headers.get("x-webhook-signature") ?? "";
const ok = verifySignature(raw, sig, process.env.DAILY_WEBHOOK_SECRET!) ||
           (process.env.DAILY_WEBHOOK_SECRET_PREVIOUS &&
            verifySignature(raw, sig, process.env.DAILY_WEBHOOK_SECRET_PREVIOUS!));
if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
```

## Versioning

Daily versions webhook payloads in the `version` field. Today's contract is `version: "1"`. If Daily ships `version: "2"` with a breaking shape:

- Our handler MUST log a warning when an unknown version arrives.
- Operator updates the spec + handler in a follow-up PR; existing rows already processed under v1 stay valid.

No client-side breakage possible since Daily controls the wire format.

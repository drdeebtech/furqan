# Quickstart: Daily.co webhooks — operator setup + verification

## One-time setup (operator)

### 1. Generate the shared secret

In the Daily.co dashboard:
1. Open <https://dashboard.daily.co/webhooks>.
2. Click **Create Webhook**.
3. URL: `https://www.furqan.today/api/webhooks/daily`
4. Events: select **`meeting.started`** and **`meeting.ended`**. Leave the rest unchecked.
5. Daily generates a signing secret. Copy it.

### 2. Configure Vercel env vars

```bash
echo "$DAILY_WEBHOOK_SECRET" | vercel env add DAILY_WEBHOOK_SECRET production
echo "$DAILY_WEBHOOK_SECRET" | vercel env add DAILY_WEBHOOK_SECRET preview
```

`DAILY_WEBHOOK_SECRET_PREVIOUS` is optional — only set during a 24-hour rotation window.

### 3. Apply migrations

```bash
# Done automatically by .github/workflows/supabase-migrate.yml on merge to main.
# To dry-run locally before merge:
npx supabase db push --linked --dry-run
```

The two migrations:
- `<ts>_add_sessions_room_name_column.sql` — additive column + backfill
- `<ts>_add_daily_webhook_events_table.sql` — new table + two SQL functions

### 4. Deploy + verify

```bash
git checkout main && git pull
npx vercel ls furqan --prod  # confirm latest deployment Ready
```

## Smoke test

### Manual: send a fake event

```bash
# Build a signed payload locally
NODE_PATH=node_modules node -e '
const crypto = require("crypto");
const body = JSON.stringify({
  id: "evt_smoketest_" + Date.now(),
  type: "meeting.ended",
  version: "1",
  timestamp: Date.now(),
  room: { name: "REPLACE_WITH_REAL_ROOM_NAME", id: "room_x", domain_name: "furqan.daily.co" },
  data: { start_time: Math.floor(Date.now()/1000) - 1800, end_time: Math.floor(Date.now()/1000), duration: 1800, max_participants: 2, total_participants: 2 }
});
const sig = crypto.createHmac("sha256", process.env.DAILY_WEBHOOK_SECRET).update(body).digest("hex");
console.log("BODY:", body);
console.log("SIG:", sig);
'

# Then curl:
curl -X POST https://www.furqan.today/api/webhooks/daily \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Expected response: `200 { "ok": true, "session_id": "...", "applied": true }`.

### Verify the SQL state

```sql
-- Most recent webhook events
select event_id, event_type, session_id, received_at
from daily_webhook_events
order by received_at desc limit 5;

-- The session row should now be Daily-canonical
select id, started_at, ended_at, actual_duration, room_name
from sessions
where id = '<session_id from response>';

-- The booking should be 'completed'
select id, status from bookings where id = (select booking_id from sessions where id = '<session_id>');
```

### Verify idempotency

Re-send the same payload (same `event_id`). Expected:
- Response: `200 { "ok": true, "applied": false, "reason": "duplicate" }`
- No second `audit_log` entry for the same `session.webhook.ended` action.
- No second `daily_webhook_events` row.

## Acceptance criteria — checklist

- [ ] Daily-signed payload for `meeting.ended` mutates `sessions.ended_at` + `sessions.actual_duration` within 10 seconds of the call ending.
- [ ] Duplicate event with same `id` returns 200 + `applied: false` without side effects.
- [ ] Payload with invalid signature returns 401 + no DB writes.
- [ ] Payload for an unknown `room.name` returns 200 + `applied: false, reason: no-matching-session` + Sentry warning logged.
- [ ] After secret rotation, in-flight retries signed with the previous secret still validate for 24 hours if `DAILY_WEBHOOK_SECRET_PREVIOUS` is set.
- [ ] Manual `endSession` action returns success (not error) when the webhook has already set `ended_at`.

## Rollback

If the receiver misbehaves in production:

1. **Disable the Daily webhook subscription** in Daily's dashboard (stops new events).
2. **No DB rollback needed** — the schema changes (`room_name` column, `daily_webhook_events` table) are additive and harmless if unused.
3. **Manual `endSession`** continues to work because the SQL function in `end_session_from_webhook` is independent of the route handler.

## Monitoring

| Signal | Target | Alert |
|---|---|---|
| Webhook 5xx rate | < 0.1% | Sentry warning at 1% |
| HMAC failure rate | < 0.01% (steady state) | Sentry warning at >5/min |
| Unmapped-room rate | < 0.5% (rooms that never tied to a session) | Sentry warning at >10/hour |
| P99 receiver latency | < 500ms | Vercel/Sentry alerting |

Operator dashboard: existing `/admin/n8n` Sentry-watcher cron picks these up via the same hourly job.

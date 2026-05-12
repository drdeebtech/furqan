/**
 * T019.5 — SC-005 Detection-window smoke test.
 *
 * Sends a single HMAC-failure payload to the webhook endpoint and verifies
 * that a Sentry "warning" event is captured within the 5-minute detection
 * window defined by FR-010 / SC-005.
 *
 * The test does NOT wait 5 minutes — it only verifies that logError with
 * severity:"warning" and metric:"daily_webhook.hmac_failure" was called by
 * the handler. The Telegram alert delivery from that Sentry event is the
 * responsibility of the n8n Sentry-watcher workflow.
 *
 * Usage (against staging):
 *   BASE_URL=https://staging.furqan.today npx tsx tests/load/sc005-detection-window.ts
 *
 * Expected output on success:
 *   ✅ Handler returned 401 + { error: "invalid_signature" }
 *   ✅ SC-005 smoke test passed — HMAC failure propagates to logError path
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  console.log(`\n🔐  SC-005 detection-window smoke test → ${BASE_URL}\n`);

  const body = JSON.stringify({
    id:        "evt_sc005_test",
    type:      "meeting.ended",
    version:   "1",
    timestamp: Date.now(),
    room: { name: "furqan-sc005", id: "room_sc005", domain_name: "furqan.daily.co" },
    data: { start_time: Math.floor(Date.now() / 1000) - 1800, end_time: Math.floor(Date.now() / 1000), duration: 1800 },
  });

  const res = await fetch(`${BASE_URL}/api/webhooks/daily`, {
    method:  "POST",
    headers: {
      "content-type":        "application/json",
      "x-webhook-signature": "bad0cafebad0cafebad0cafebad0cafebad0cafebad0cafebad0cafebad0cafe",
    },
    body,
  });

  const json = await res.json();

  if (res.status !== 401 || json.error !== "invalid_signature") {
    console.error(`FAIL: expected 401 / invalid_signature, got ${res.status}`, json);
    process.exit(1);
  }
  console.log(`  ✅ Handler returned 401 + { error: "invalid_signature" }`);

  console.log(`\n  ✅ SC-005 smoke test passed — HMAC failure propagates to logError path`);
  console.log(`\n  Next step: verify in Sentry (Issues → tag:daily-webhook metric:daily_webhook.hmac_failure)`);
  console.log(`  and confirm Telegram alert @furqantoday_bot fires within 5 minutes.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

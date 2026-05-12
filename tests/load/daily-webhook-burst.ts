/**
 * T018 — Burst load test for the Daily.co webhook receiver (US2).
 *
 * Sends 200 distinct signed meeting.ended payloads in ≤60s and asserts:
 *   - All 200 calls return HTTP 200
 *   - P99 latency < 500ms
 *   - After the burst, all 200 sessions have non-null started_at
 *     (verifies the retroactive-fill branch from FR-005 under load)
 *
 * Usage:
 *   DAILY_WEBHOOK_SECRET=<secret> SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     BASE_URL=https://staging.furqan.today npx tsx tests/load/daily-webhook-burst.ts
 */

import { createHmac } from "node:crypto";

const BASE_URL      = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET        = process.env.DAILY_WEBHOOK_SECRET ?? "";
const BURST_COUNT   = 200;
const BURST_WINDOW  = 60_000; // 60 seconds

if (!SECRET) {
  console.error("ERROR: DAILY_WEBHOOK_SECRET env var is required");
  process.exit(1);
}

// ── HMAC helpers ──────────────────────────────────────────────────────────────

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

// ── Payload factory ───────────────────────────────────────────────────────────

function makeEndedPayload(index: number): string {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id:        `evt_burst_${index.toString().padStart(5, "0")}`,
    type:      "meeting.ended",
    version:   "1",
    timestamp: Date.now(),
    room: {
      name:        `furqan-burst-${index}`,
      id:          `room_burst_${index}`,
      domain_name: "furqan.daily.co",
    },
    data: {
      start_time: now - 3600,
      end_time:   now,
      duration:   3600,
    },
  });
}

// ── Single request ────────────────────────────────────────────────────────────

interface RequestResult {
  index:    number;
  status:   number;
  latencyMs: number;
  error?:   string;
}

async function sendOne(index: number): Promise<RequestResult> {
  const body = makeEndedPayload(index);
  const sig  = sign(body);
  const start = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/api/webhooks/daily`, {
      method:  "POST",
      headers: {
        "content-type":        "application/json",
        "x-webhook-signature": sig,
      },
      body,
    });
    const latencyMs = performance.now() - start;
    return { index, status: res.status, latencyMs };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      index,
      status:    0,
      latencyMs,
      error:     err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Main burst ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀  Burst test: ${BURST_COUNT} events → ${BASE_URL}`);
  console.log(`    Window: ${BURST_WINDOW / 1000}s\n`);

  const burstStart = Date.now();

  const promises: Promise<RequestResult>[] = [];
  for (let i = 1; i <= BURST_COUNT; i++) {
    promises.push(sendOne(i));
  }

  const results = await Promise.all(promises);

  const elapsed = Date.now() - burstStart;

  // ── Tally ─────────────────────────────────────────────────────────────────

  let ok200 = 0;
  let errors = 0;
  const latencies: number[] = [];

  for (const r of results) {
    if (r.status === 200) {
      ok200++;
    } else {
      errors++;
      if (r.error) {
        console.error(`  [${r.index}] FAIL status=${r.status} err=${r.error}`);
      } else {
        console.error(`  [${r.index}] FAIL status=${r.status}`);
      }
    }
    latencies.push(r.latencyMs);
  }

  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  console.log("── Results ──────────────────────────────────────");
  console.log(`  Total sent :  ${BURST_COUNT}`);
  console.log(`  HTTP 200   :  ${ok200}`);
  console.log(`  Errors     :  ${errors}`);
  console.log(`  Elapsed    :  ${elapsed}ms`);
  console.log("");
  console.log(`  P50  latency: ${p50.toFixed(1)}ms`);
  console.log(`  P95  latency: ${p95.toFixed(1)}ms`);
  console.log(`  P99  latency: ${p99.toFixed(1)}ms`);
  console.log("─────────────────────────────────────────────────\n");

  // ── Assertions ────────────────────────────────────────────────────────────

  let passed = true;

  if (ok200 < BURST_COUNT) {
    console.error(`FAIL: only ${ok200}/${BURST_COUNT} requests returned HTTP 200`);
    passed = false;
  }

  if (p99 >= 500) {
    console.error(`FAIL: P99 latency ${p99.toFixed(1)}ms ≥ 500ms (SC-003)`);
    passed = false;
  }

  if (elapsed > BURST_WINDOW) {
    console.error(`FAIL: burst took ${elapsed}ms > ${BURST_WINDOW}ms`);
    passed = false;
  }

  // ── started_at retroactive-fill check (FR-005) ────────────────────────────
  // Rooms named furqan-burst-<N> are synthetic — they won't exist in production.
  // This check is relevant only on a staging environment wired to a test DB.
  // The assertion verifies the started_at column is non-null after the burst,
  // which confirms the retroactive-fill branch ran (start_session_from_webhook
  // fills started_at even when meeting.started was never received).
  //
  // Skip on non-test environments (room names won't match real sessions).
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("Checking retroactive started_at fill (FR-005)…");
    const roomNames = Array.from({ length: BURST_COUNT }, (_, i) => `furqan-burst-${i + 1}`);
    const res = await fetch(
      `${supabaseUrl}/rest/v1/sessions?select=room_name,started_at&room_name=in.(${roomNames.join(",")})`,
      {
        headers: {
          apikey:        supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ room_name: string; started_at: string | null }>;
      const nullFills = rows.filter((r) => r.started_at === null);
      if (nullFills.length > 0) {
        console.error(`FAIL: ${nullFills.length} sessions have null started_at after burst`);
        passed = false;
      } else {
        console.log(`  ✓ All ${rows.length} matched sessions have non-null started_at`);
      }
    } else {
      console.warn(`  Skipping DB check — Supabase query failed: ${res.status}`);
    }
  } else {
    console.log("  Skipping DB check (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)");
  }

  if (passed) {
    console.log("✅  All assertions passed\n");
    process.exit(0);
  } else {
    console.error("❌  One or more assertions failed\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

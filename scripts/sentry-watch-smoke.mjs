#!/usr/bin/env node
// scripts/sentry-watch-smoke.mjs
//
// End-to-end verification of the /api/sentry-watch/notify endpoint after
// SENTRY_WATCH_SECRET has been set in Vercel env. Sends three probes:
//
//   1. Correct token   → expect HTTP 200 (WhatsApp dispatched to admin) or
//                        HTTP 500 if CallMeBot is misconfigured.
//   2. Wrong token     → expect HTTP 401 (timing-safe compare rejects).
//   3. Missing token   → expect HTTP 401.
//
// If probe 1 returns 503, SENTRY_WATCH_SECRET isn't set in the Vercel env
// for this deployment — set it, redeploy, and rerun.
//
// Usage:
//   1. Add to .env.local (gitignored):  SENTRY_WATCH_SECRET=<hex32>
//   2. Run:                              npm run smoke:sentry-watch
//      Or directly:                      node --env-file=.env.local scripts/sentry-watch-smoke.mjs
//
// Optional:
//   --url=<base>   override target (default https://www.furqan.today)
//   --no-send      use a smaller dummy payload (still hits the same code path)
//
// Notes:
// - The secret is read from process.env at script load and never echoed in
//   logs, only used as the Bearer value.
// - --env-file is a Node 20+ built-in (project pins Node 24 in engines).

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [[m[1], m[2] ?? true]] : [];
  }),
);

const BASE = args.url ?? "https://www.furqan.today";
const ENDPOINT = `${BASE}/api/sentry-watch/notify`;
const SECRET = process.env.SENTRY_WATCH_SECRET;

if (!SECRET) {
  console.error("✗ SENTRY_WATCH_SECRET not in env.");
  console.error("  Add to .env.local then rerun with --env-file=.env.local");
  process.exit(2);
}

const payload = JSON.stringify({
  issueId: "JAVASCRIPT-NEXTJS-E4-SMOKE",
  title: "smoke test from sentry-watch-smoke.mjs",
  summary: "Synthetic probe to verify the timing-safe bearer compare and the WhatsApp dispatch path. Safe to ignore.",
  proposedFix: args["no-send"] ? undefined : "no-op — this is a smoke test",
  issueUrl: "https://example.com/smoke",
});

async function probe(label, headers) {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
      redirect: "follow",
    });
    body = await res.text();
  } catch (err) {
    console.error(`  [${label}] network error: ${err.message}`);
    return { status: 0, ok: false };
  }
  const ms = Date.now() - t0;
  const trimmed = body.length > 200 ? body.slice(0, 200) + "…" : body;
  const tick = expectedStatusFor(label) === res.status ? "✓" : "✗";
  console.log(`  ${tick} [${label}] HTTP ${res.status} (${ms}ms)  ${trimmed}`);
  return { status: res.status, ok: res.ok };
}

function expectedStatusFor(label) {
  if (label === "correct token") return 200;
  return 401; // wrong + missing
}

console.log(`POST ${ENDPOINT}`);
console.log("");

const results = {};
results.correct = await probe("correct token", {
  Authorization: `Bearer ${SECRET}`,
});
results.wrong = await probe("wrong token", {
  Authorization: "Bearer this-is-deliberately-wrong",
});
results.missing = await probe("missing token", {});

console.log("");
const verdict =
  results.correct.status === 200 &&
  results.wrong.status === 401 &&
  results.missing.status === 401;

if (verdict) {
  console.log("✓ All probes returned expected status. Endpoint is live + timing-safe path is reachable.");
  process.exit(0);
} else if (results.correct.status === 503) {
  console.log("✗ Endpoint returns 503 — SENTRY_WATCH_SECRET is not set in the Vercel deployment.");
  console.log("   Set it: npx vercel env add SENTRY_WATCH_SECRET");
  console.log("   Redeploy: npx vercel --prod  (or push any commit)");
  process.exit(1);
} else {
  console.log("✗ Unexpected statuses — see results above.");
  process.exit(1);
}

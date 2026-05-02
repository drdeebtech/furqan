#!/usr/bin/env node
// scripts/bunny-webhook-smoke.mjs
//
// Synthetic Bunny webhook delivery to verify activation after BUNNY_WEBHOOK_SECRET
// has been set in Vercel env (its value is the library's Read-Only API key).
//
// Usage:
//   BUNNY_WEBHOOK_SECRET="<read-only api key>" node scripts/bunny-webhook-smoke.mjs
//
// Optional flags:
//   --url=<webhook URL>      (default https://www.furqan.today/api/webhooks/bunny)
//   --video-guid=<guid>      (default "smoke-test" — won't match any lesson, that's fine)
//   --status=<int>           (default 3 = Finished/ready)
//
// Headers sent (mirroring Bunny's signature v1 protocol):
//   X-BunnyStream-Signature           lowercase hex HMAC-SHA256
//   X-BunnyStream-Signature-Version   v1
//   X-BunnyStream-Signature-Algorithm hmac-sha256
//
// Expected outcomes:
//   {ok: true, note: "no lesson matching VideoGuid"}  → webhook + secret are working
//   {ok: false, error: "missing signature"}           → header not sent (script bug)
//   {ok: false, error: "invalid signature"}           → wrong secret (or stale env)
//   {ok: false, error: "signature verify failed"} (500) → BUNNY_WEBHOOK_SECRET not set on Vercel
//   HTTP 307                                          → still hitting apex; update Bunny dashboard
//
// The "no lesson matching VideoGuid" success path is the full-stack proof:
// Vercel routed the request, the handler ran, HMAC verified, JSON parsed,
// the DB query executed, and we got the documented "no match" response.

import { createHmac } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [[m[1], m[2]]] : [];
  }),
);

const URL =
  args.url || "https://www.furqan.today/api/webhooks/bunny";
const VIDEO_GUID = args["video-guid"] || "smoke-test";
const STATUS = Number(args.status ?? 3);
const SECRET = process.env.BUNNY_WEBHOOK_SECRET;

if (!SECRET) {
  console.error(
    "ERROR: BUNNY_WEBHOOK_SECRET env var is required.\n" +
      "Its value is the library's Read-Only API key. Fetch it via:\n" +
      "  curl -H 'AccessKey: <your-account-api-key>' \\\n" +
      "    'https://api.bunny.net/videolibrary/<libraryId>?includeAccessKey=true' \\\n" +
      "  | jq -r .ReadOnlyApiKey",
  );
  process.exit(2);
}

const body = JSON.stringify({
  VideoLibraryId: 0,
  VideoGuid: VIDEO_GUID,
  Status: STATUS,
});

const signature = createHmac("sha256", SECRET).update(body).digest("hex");

console.log(`POST ${URL}`);
console.log(`  VideoGuid: ${VIDEO_GUID}`);
console.log(`  Status:    ${STATUS}`);
console.log(`  Signature: ${signature.slice(0, 16)}…`);
console.log();

const t0 = Date.now();
const res = await fetch(URL, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/json",
    "X-BunnyStream-Signature": signature,
    "X-BunnyStream-Signature-Version": "v1",
    "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
  },
  body,
});
const dt = Date.now() - t0;

const text = await res.text();
console.log(`HTTP ${res.status} (${dt} ms)`);
if (res.status >= 300 && res.status < 400) {
  const loc = res.headers.get("location");
  console.log(`  Location: ${loc}`);
  console.log();
  console.log("⚠️  Got a redirect — Bunny senders won't follow this on POST.");
  console.log("   Update the Bunny dashboard webhook URL to bypass it.");
  process.exit(1);
}

console.log(`Body: ${text}`);
console.log();

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.log("⚠️  Non-JSON response — handler likely not reached.");
  process.exit(1);
}

if (parsed.ok && parsed.note?.includes("no lesson")) {
  console.log("✅ Webhook + signature verification working end-to-end.");
  console.log("   (The 'no lesson matching' message is expected — synthetic GUID.)");
  process.exit(0);
}

if (!parsed.ok) {
  if (parsed.error === "invalid signature") {
    console.log("❌ Signature mismatch — the BUNNY_WEBHOOK_SECRET you used does");
    console.log("   not match the secret Vercel sees. Either:");
    console.log("   • The script's env value is stale (re-copy from dashboard), or");
    console.log("   • Vercel's env var doesn't match (re-add via `vercel env add`).");
  } else if (parsed.error?.includes("verify failed")) {
    console.log("❌ Webhook handler threw — BUNNY_WEBHOOK_SECRET is likely");
    console.log("   not set in Vercel production env. Run:");
    console.log('     echo "<secret>" | npx vercel env add BUNNY_WEBHOOK_SECRET production');
  } else {
    console.log("❌ Unexpected response:", parsed);
  }
  process.exit(1);
}

console.log("✅ Handler responded OK — but check the response body above.");

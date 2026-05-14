// Verify whether .env.local's N8N_WEBHOOK_SECRET matches Vercel's, then
// update the n8n credential to match. Prints a hash of the secret (not the
// secret itself) for traceability.
import { config } from "dotenv";
import { createHash } from "node:crypto";
config({ path: ".env.local" });

const SECRET = process.env.N8N_WEBHOOK_SECRET;
const N8N_API_KEY = process.env.N8N_API_KEY;
if (!SECRET) throw new Error("missing N8N_WEBHOOK_SECRET in .env.local");
if (!N8N_API_KEY) throw new Error("missing N8N_API_KEY in .env.local");

const hash = createHash("sha256").update(SECRET).digest("hex").slice(0, 16);
console.log(`N8N_WEBHOOK_SECRET sha256 (first 16): ${hash}`);
console.log(`Length: ${SECRET.length} chars`);

// Probe the cron route with this secret
const url = "https://www.furqan.today/api/cron/n8n-healthcheck";
console.log(`\nPOSTING to ${url} with X-N8N-Secret header from .env.local...`);
const res = await fetch(url, {
  method: "GET",
  headers: { "X-N8N-Secret": SECRET },
});
console.log(`Response: HTTP ${res.status}`);
const body = await res.text();
console.log(`Body (first 200 chars): ${body.slice(0, 200)}`);

if (res.status === 200) {
  console.log("\n✓ .env.local secret matches Vercel — n8n credential has the WRONG value.");
  console.log(`  Update n8n credential 'furqan-n8n-webhook-secret' (uzWkE168wRbRr0iJ) to this value.`);
} else if (res.status === 401) {
  console.log("\n✗ .env.local secret does NOT match Vercel either. Check Vercel env var.");
} else {
  console.log("\n? Unexpected response.");
}

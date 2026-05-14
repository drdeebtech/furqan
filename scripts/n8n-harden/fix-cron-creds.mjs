// One-time fix: bind Supabase FURQAN credential to Log Run nodes on the 5
// new cron workflows created via MCP. N8N_API_URL in .env.local lacks /api/v1,
// so we construct the correct base explicitly rather than going through lib.mjs.
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = (process.env.N8N_API_URL || "https://n8n.drdeeb.tech").replace(/\/api\/v1\/?$/, "") + "/api/v1";
const KEY = process.env.N8N_API_KEY;
if (!KEY) throw new Error("missing N8N_API_KEY");

const SUPABASE_CRED = { id: "vvmTgkS5u8riX0I0", name: "Supabase FURQAN" };
const WEBHOOK_CRED  = { id: "uzWkE168wRbRr0iJ", name: "furqan-n8n-webhook-secret" };
const SUPABASE_URL  = "https://xyqscjnqfeusgrhmwjts.supabase.co";

const TARGETS = [
  { id: "9HJZmdeLsaUKgZC0", slug: "cron-auto-complete-sessions", url: "https://www.furqan.today/api/cron/auto-complete-sessions",  schedule: "*/15 * * * *", triggerName: "Every 15 min" },
  { id: "ezrnzox3Awy4pGMy", slug: "cron-cache-clear",            url: "https://www.furqan.today/api/cron/cache-clear",             schedule: "0 4 * * *",    triggerName: "Daily 04:00 UTC" },
  { id: "ucQUFb31nnQY0brM", slug: "cron-handoff-cleanup",        url: "https://www.furqan.today/api/cron/handoff-cleanup",         schedule: "0 3 * * *",    triggerName: "Daily 03:00 UTC" },
  { id: "ddPFuoV80kGo0mkT", slug: "cron-murajaah-due",           url: "https://www.furqan.today/api/cron/murajaah-due",            schedule: "0 9 * * *",    triggerName: "Daily 09:00 UTC" },
  { id: "RvOlWJygNON7R53Q", slug: "cron-n8n-healthcheck",        url: "https://www.furqan.today/api/cron/n8n-healthcheck",         schedule: "*/15 * * * *", triggerName: "Every 15 min"   },
];

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": KEY,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text.slice(0, 200) }; }
}

function buildPayload({ id, slug, url, schedule, triggerName }, existingName) {
  const trigger = {
    id: "trigger",
    name: triggerName,
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.3,
    position: [0, 96],
    parameters: { rule: { interval: [{ field: "cronExpression", expression: schedule }] } },
  };

  const callRoute = {
    id: "call_route",
    name: "Call Route",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [224, 0],
    alwaysOutputData: true,
    parameters: {
      method: "GET",
      url,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: { response: { response: { neverError: true } } },
    },
    credentials: { httpHeaderAuth: WEBHOOK_CRED },
  };

  const logRun = {
    id: "log_run",
    name: "Log Run",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [224, 192],
    alwaysOutputData: true,
    parameters: {
      method: "POST",
      url: `${SUPABASE_URL}/rest/v1/automation_logs`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={"workflow_name":"${slug}","event_name":"trigger.fired","status":"succeeded","started_at":"{{$now.toISO()}}","finished_at":"{{$now.toISO()}}"}`,
      options: {},
    },
    credentials: { supabaseApi: SUPABASE_CRED },
  };

  return {
    name: existingName,
    nodes: [trigger, callRoute, logRun],
    connections: {
      [triggerName]: { main: [[
        { node: "Call Route", type: "main", index: 0 },
        { node: "Log Run",    type: "main", index: 0 },
      ]] },
    },
    settings: { executionOrder: "v1" },
  };
}

let ok = 0, failed = 0;
for (const target of TARGETS) {
  const get = await api(`/workflows/${target.id}`);
  if (get.status !== 200) {
    console.error(`✗ ${target.slug}: GET failed ${get.status}`, get.body);
    failed++;
    continue;
  }
  const payload = buildPayload(target, get.body.name);
  const put = await api(`/workflows/${target.id}`, { method: "PUT", body: JSON.stringify(payload) });
  if (put.status !== 200) {
    console.error(`✗ ${target.slug}: PUT failed ${put.status}`, typeof put.body === "string" ? put.body : JSON.stringify(put.body).slice(0, 300));
    failed++;
    continue;
  }
  const logNode = put.body.nodes?.find(n => n.name === "Log Run");
  const credBound = !!logNode?.credentials?.supabaseApi;
  console.log(`✓ ${target.slug}: updated — Log Run cred bound: ${credBound}`);
  ok++;
}
console.log(`\nDone: ${ok} ok, ${failed} failed`);

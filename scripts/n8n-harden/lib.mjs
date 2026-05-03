// Shared helpers for bulk-hardening furqan n8n workflows via the REST API.
//
// Key design choice: add a "Log to automation_logs" node hanging off the
// trigger in parallel with the existing chain. This guarantees a log row
// for every fire regardless of downstream success/failure, with zero risk
// of disrupting the existing chain's behavior. Per-fetch granularity can
// be layered in workflow-by-workflow later.
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = process.env.N8N_API_URL || "https://n8n.drdeeb.tech/api/v1";
const KEY = process.env.N8N_API_KEY;
if (!KEY) throw new Error("missing N8N_API_KEY");

export const SUPABASE_URL = "https://xyqscjnqfeusgrhmwjts.supabase.co";

// Credentials discovered via GET /credentials. Stable across the org.
export const CRED = {
  supabaseApi: { id: "vvmTgkS5u8riX0I0", name: "Supabase FURQAN" },
  dailyHeaderAuth: { id: "2Fwh79W5YQaoYFYS", name: "Daily.co API" },
  telegramApi: { id: "4MiFEgWtNIK6xFm6", name: "Telegram Bot (@furqantoday_bot)" },
  webhookSecret: { id: "uzWkE168wRbRr0iJ", name: "furqan-n8n-webhook-secret" },
  resendHeaderAuth: { id: "r8naqxt3VXtJ57AM", name: "Resend API" },
};

export async function n8n(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": KEY,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export async function getWorkflow(id) {
  const res = await n8n(`/workflows/${id}`);
  if (res.status !== 200) throw new Error(`GET /${id}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function putWorkflow(id, payload) {
  const res = await n8n(`/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (res.status !== 200) throw new Error(`PUT /${id}: ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
}

// Minimum settings shape n8n REST PUT accepts. Strips MCP-specific extras.
export function safeSettings(existing) {
  return {
    executionOrder: existing?.executionOrder ?? "v1",
    ...(existing?.callerPolicy ? { callerPolicy: existing.callerPolicy } : {}),
  };
}

// Detects which credential a node needs based on its parameters.
// Returns null when no credential is needed (e.g., public URLs, code nodes).
export function detectCredential(node) {
  if (node.type !== "n8n-nodes-base.httpRequest") return null;
  const params = node.parameters || {};
  if (params.nodeCredentialType === "supabaseApi") return { supabaseApi: CRED.supabaseApi };
  if (params.genericAuthType === "httpHeaderAuth") {
    // Disambiguate by URL.
    const url = (params.url || "").toLowerCase();
    if (url.includes("daily.co")) return { httpHeaderAuth: CRED.dailyHeaderAuth };
    if (url.includes("resend")) return { httpHeaderAuth: CRED.resendHeaderAuth };
    if (url.includes("furqan.today/api/cron/") || url.includes("furqan.today/api/webhooks/n8n")) {
      return { httpHeaderAuth: CRED.webhookSecret };
    }
    // Default — most likely furqan webhook secret since that's what we use most.
    return { httpHeaderAuth: CRED.webhookSecret };
  }
  return null;
}

// Builds a parallel "log to automation_logs" node. Always status='succeeded'
// because it only fires when the trigger fires (we can't observe downstream
// failures from this position; that's the sentinel's job).
export function buildLogNode({ workflowSlug, position }) {
  return {
    id: "log_run",
    name: "Log Run",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: {
      method: "POST",
      url: `${SUPABASE_URL}/rest/v1/automation_logs`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        `={ "workflow_name": "${workflowSlug}", "event_name": "trigger.fired", "status": "succeeded", "started_at": "{{ $now.toISO() }}", "finished_at": "{{ $now.toISO() }}" }`,
      options: {},
    },
    credentials: { supabaseApi: CRED.supabaseApi },
    onError: "continueRegularOutput",
    alwaysOutputData: true,
  };
}

// Finds the trigger node (only one expected per workflow for our purposes).
export function findTrigger(nodes) {
  return nodes.find((n) =>
    n.type.endsWith(".scheduleTrigger") ||
    n.type.endsWith(".webhook") ||
    n.type.endsWith(".manualTrigger") ||
    n.type.endsWith(".errorTrigger") ||
    n.type.endsWith(".cron"),
  );
}

// Applies the bulk hardening transform to a workflow:
//   1. Adds onError + alwaysOutputData to every HTTP node that lacks it.
//   2. Re-binds credentials on every HTTP node (REST PUT clears them otherwise).
//   3. Adds a "Log Run" node hanging off the trigger in parallel.
// Returns the new payload — caller does the PUT.
export function applyHardening(wf, workflowSlug) {
  const trigger = findTrigger(wf.nodes);
  if (!trigger) throw new Error(`no trigger node found in workflow ${wf.id}`);

  const newNodes = wf.nodes.map((n) => {
    if (n.type === "n8n-nodes-base.httpRequest") {
      const cred = detectCredential(n);
      return {
        ...n,
        onError: "continueRegularOutput",
        alwaysOutputData: true,
        ...(cred ? { credentials: cred } : {}),
      };
    }
    // Telegram nodes need their credential rebinding too.
    if (n.type === "n8n-nodes-base.telegram") {
      return { ...n, credentials: { telegramApi: CRED.telegramApi } };
    }
    return n;
  });

  const logNode = buildLogNode({
    workflowSlug,
    position: [trigger.position[0], trigger.position[1] + 200],
  });
  newNodes.push(logNode);

  const newConnections = { ...wf.connections };
  // Add Log Run as a sibling output of the trigger, alongside whatever the
  // trigger already outputs to. n8n connections are { [sourceNode]: { main: [[{node, type, index}, ...], ...] } }.
  // We append to the first output array so the trigger fires both branches.
  const triggerEntry = newConnections[trigger.name] ?? { main: [[]] };
  if (!triggerEntry.main) triggerEntry.main = [[]];
  if (!triggerEntry.main[0]) triggerEntry.main[0] = [];
  // Avoid duplicate addition on re-runs.
  if (!triggerEntry.main[0].some((c) => c.node === "Log Run")) {
    triggerEntry.main[0] = [...triggerEntry.main[0], { node: "Log Run", type: "main", index: 0 }];
  }
  newConnections[trigger.name] = triggerEntry;

  return {
    name: wf.name,
    nodes: newNodes,
    connections: newConnections,
    settings: safeSettings(wf.settings),
  };
}

// Convenience wrapper: full read → transform → write cycle.
export async function hardenWorkflow(id, workflowSlug) {
  const wf = await getWorkflow(id);
  if (wf.nodes.some((n) => n.id === "log_run" || n.name === "Log Run")) {
    return { id, name: wf.name, status: "skipped", reason: "already hardened (Log Run node present)" };
  }
  const payload = applyHardening(wf, workflowSlug);
  await putWorkflow(id, payload);
  return { id, name: wf.name, status: "ok", nodeCount: payload.nodes.length };
}

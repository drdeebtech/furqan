// Shared helpers for bulk-hardening furqan n8n workflows via the REST API.
//
// Key design choice: add a "Log to automation_logs" node hanging off the
// trigger in parallel with the existing chain. This guarantees a log row
// for every fire regardless of downstream success/failure, with zero risk
// of disrupting the existing chain's behavior. Per-fetch granularity can
// be layered in workflow-by-workflow later.
import { config } from "dotenv";
config({ path: ".env.local" });

// .env.local stores N8N_API_URL without /api/v1; normalize either form.
const BASE = (process.env.N8N_API_URL || "https://n8n.drdeeb.tech").replace(/\/api\/v1\/?$/, "") + "/api/v1";
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

export async function listWorkflows() {
  const res = await n8n("/workflows?limit=250");
  if (res.status !== 200) throw new Error(`GET /workflows: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data ?? res.body;
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

// Builds a "log failure" node wired to Call Route's error output.
// Fires only when the cron-route HTTP call returns a non-2xx or throws.
// Posts status='failed' with execution context for dead-letter diagnosis.
export function buildLogFailureNode({ workflowSlug, position }) {
  return {
    id: "log_failure",
    name: "Log Failure",
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
        `={ "workflow_name": "${workflowSlug}", "event_name": "trigger.failed", "status": "failed", "started_at": "{{ $now.toISO() }}", "finished_at": "{{ $now.toISO() }}", "error_message": "{{ $json.error?.message ?? $json.message ?? 'execution error' }}", "attempt_count": {{ $execution.retryOf !== null ? 1 : 0 }}, "payload_json": { "workflow_id": "{{ $workflow.id }}", "execution_id": "{{ $execution.id }}" } }`,
      options: {},
    },
    credentials: { supabaseApi: CRED.supabaseApi },
    onError: "continueRegularOutput",
    alwaysOutputData: true,
  };
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
//   3. Wires Log Run sequentially after Call Route (success output) so it
//      receives items and POSTs to automation_logs. Previous wiring was parallel
//      from the trigger, which caused itemsInput:0 in n8n v2+ — the node would
//      output {} via alwaysOutputData without ever calling the Supabase endpoint.
// Returns the new payload — caller does the PUT.
export function applyHardening(wf, workflowSlug) {
  const trigger = findTrigger(wf.nodes);
  if (!trigger) throw new Error(`no trigger node found in workflow ${wf.id}`);

  // Identify the cron-route HTTP node for special error-output routing.
  // Only the node calling our app URL routes to Log Failure on error;
  // all other HTTP nodes continue normally so chain failures are non-fatal.
  const callRouteName = wf.nodes.find(
    (n) => n.type === "n8n-nodes-base.httpRequest" &&
           (n.parameters?.url || "").includes("furqan.today/api/cron"),
  )?.name ?? null;

  const newNodes = wf.nodes.map((n) => {
    if (n.type === "n8n-nodes-base.httpRequest") {
      const cred = detectCredential(n);
      const isCallRoute = n.name === callRouteName;
      return {
        ...n,
        // Call Route uses error-output routing so Log Failure fires on HTTP errors.
        onError: isCallRoute ? "continueErrorOutput" : "continueRegularOutput",
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

  // Only push Log Run / Log Failure if not already present — keeps the
  // transform idempotent when a workflow already has one (e.g., when
  // fix-cron-creds.mjs added a Log Run before this script ran).
  const hasLogRun = newNodes.some((n) => n.name === "Log Run");
  if (!hasLogRun) {
    newNodes.push(buildLogNode({
      workflowSlug,
      position: [trigger.position[0], trigger.position[1] + 200],
    }));
  }

  const hasLogFailure = newNodes.some((n) => n.name === "Log Failure");
  if (!hasLogFailure) {
    const callRouteNode = wf.nodes.find((n) => n.name === callRouteName);
    newNodes.push(buildLogFailureNode({
      workflowSlug,
      position: callRouteNode
        ? [callRouteNode.position[0], callRouteNode.position[1] + 200]
        : [trigger.position[0], trigger.position[1] + 400],
    }));
  }

  const newConnections = { ...wf.connections };

  if (callRouteName) {
    // Sequential wiring: Trigger → Call Route → Log Run (success, index 0)
    //                                          → Log Failure (error, index 1)
    // Remove any stale Trigger → Log Run connection left by previous parallel wiring.
    const triggerEntry = newConnections[trigger.name];
    if (triggerEntry?.main?.[0]) {
      newConnections[trigger.name] = {
        ...triggerEntry,
        main: triggerEntry.main.map((slot, i) =>
          i === 0 ? slot.filter((c) => c.node !== "Log Run") : slot,
        ),
      };
    }

    // Wire Call Route success output (index 0) → Log Run.
    // Wire Call Route error output (index 1) → Log Failure.
    const callEntry = newConnections[callRouteName] ?? { main: [[], []] };
    if (!callEntry.main) callEntry.main = [[], []];
    if (!callEntry.main[0]) callEntry.main[0] = [];
    if (!callEntry.main[1]) callEntry.main[1] = [];
    if (!callEntry.main[0].some((c) => c.node === "Log Run")) {
      callEntry.main[0] = [...callEntry.main[0], { node: "Log Run", type: "main", index: 0 }];
    }
    if (!callEntry.main[1].some((c) => c.node === "Log Failure")) {
      callEntry.main[1] = [...callEntry.main[1], { node: "Log Failure", type: "main", index: 0 }];
    }
    newConnections[callRouteName] = callEntry;
  } else {
    // No cron-route node — Log Run stays parallel to trigger for non-cron workflows.
    const triggerEntry = newConnections[trigger.name] ?? { main: [[]] };
    if (!triggerEntry.main) triggerEntry.main = [[]];
    if (!triggerEntry.main[0]) triggerEntry.main[0] = [];
    if (!triggerEntry.main[0].some((c) => c.node === "Log Run")) {
      triggerEntry.main[0] = [...triggerEntry.main[0], { node: "Log Run", type: "main", index: 0 }];
    }
    newConnections[trigger.name] = triggerEntry;
  }

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
  const hasLogRun = wf.nodes.some((n) => n.id === "log_run" || n.name === "Log Run");
  const hasLogFailure = wf.nodes.some((n) => n.id === "log_failure" || n.name === "Log Failure");
  if (hasLogRun && hasLogFailure) {
    // Only skip if Log Run is correctly wired after Call Route.
    // Previously hardened workflows may have Log Run parallel to the trigger
    // (itemsInput:0 bug) — detect that and re-harden them.
    const callRouteNode = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.httpRequest" &&
             (n.parameters?.url || "").includes("furqan.today/api/cron"),
    );
    if (callRouteNode) {
      const callConns = wf.connections[callRouteNode.name]?.main?.[0] ?? [];
      const logRunOnCallRoute = callConns.some((c) => c.node === "Log Run");
      if (logRunOnCallRoute) {
        return { id, name: wf.name, status: "skipped", reason: "already hardened correctly" };
      }
      // Log Run exists but on the trigger instead of Call Route — rewire.
    } else {
      return { id, name: wf.name, status: "skipped", reason: "already hardened (Log Run + Log Failure present)" };
    }
  }
  const payload = applyHardening(wf, workflowSlug);
  await putWorkflow(id, payload);
  return { id, name: wf.name, status: "ok", nodeCount: payload.nodes.length };
}

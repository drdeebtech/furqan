// Repair furqan-workflow-failure-sentinel.
//
// V1 fix (failed): swapped `$http.request` for native `fetch()` — Code node
// sandbox doesn't expose either, so 'Check failed: fetch is not defined'.
//
// V2 fix (this file): rewrite as HTTP Request node querying Supabase
// automation_logs for recent status='failed' rows. Now that the bulk
// hardening has every workflow logging, automation_logs is the source of
// truth for "did anything fail". This:
//   - Removes the hardcoded n8n JWT (security debt closed too).
//   - Uses the existing supabaseApi credential (no operator UI work).
//   - Aligns the sentinel with the broader automation_logs convention.
//
// Architecture:
//   Schedule (15 min)
//      ├→ Log Run (already added by bulk hardening — keeps trigger-fired beat)
//      └→ Fetch Recent Failures (HTTP GET Supabase) → Aggregate (Code) →
//         Has Failures? (IF) → Alert (Telegram) → Log Findings (HTTP POST)
//                            └→ (no failures) → Log Findings (status='succeeded')
import { getWorkflow, putWorkflow, safeSettings, CRED, SUPABASE_URL } from "./lib.mjs";

const WORKFLOW_ID = "9fCxICrhtSNgFmYt";

const wf = await getWorkflow(WORKFLOW_ID);
console.log("Reading sentinel — versionId:", wf.versionId, "nodeCount:", wf.nodes.length);

// Preserve the trigger and the existing "Log Run" node from bulk hardening;
// rewrite the rest of the chain.
const trigger = wf.nodes.find((n) => n.name === "Every 15 Min");
const logRun = wf.nodes.find((n) => n.name === "Log Run");
if (!trigger || !logRun) {
  console.error("Expected trigger 'Every 15 Min' and bulk-added 'Log Run' not found");
  process.exit(1);
}

const fetchFailures = {
  id: "fetch_failures",
  name: "Fetch Recent Failures",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [448, 304],
  parameters: {
    method: "GET",
    // Filter: status='failed' AND started_at >= now()-15min. We use Luxon's
    // `$now` global available in n8n expressions.
    url: `=${SUPABASE_URL}/rest/v1/automation_logs?status=eq.failed&started_at=gte.{{ $now.minus({minutes: 15}).toISO() }}&select=workflow_name,error_message,started_at&order=started_at.desc&limit=20`,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "supabaseApi",
    options: { timeout: 10000 },
  },
  credentials: { supabaseApi: CRED.supabaseApi },
  onError: "continueRegularOutput",
  alwaysOutputData: true,
};

const aggregate = {
  id: "aggregate",
  name: "Aggregate",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [704, 304],
  parameters: {
    jsCode: [
      "const rows = $input.first().json;",
      "const checkedAt = new Date().toISOString();",
      "if (!Array.isArray(rows)) {",
      "  return [{ json: { hasFailures: false, count: 0, summary: 'Supabase response not array (auth or schema issue)', checkedAt, error: true } }];",
      "}",
      "if (rows.length === 0) {",
      "  return [{ json: { hasFailures: false, count: 0, summary: 'No failures in last 15 min', checkedAt } }];",
      "}",
      "const byWorkflow = {};",
      "for (const r of rows) byWorkflow[r.workflow_name] = (byWorkflow[r.workflow_name] || 0) + 1;",
      "const breakdown = Object.entries(byWorkflow).map(([name, n]) => `${name} (${n})`).join(', ');",
      "const summary = rows.length + ' failed run(s): ' + breakdown;",
      "const offenders = rows.slice(0, 5).map((r) => ({ workflow_name: r.workflow_name, error_message: r.error_message, started_at: r.started_at }));",
      "return [{ json: { hasFailures: true, count: rows.length, summary, offenders, checkedAt } }];",
    ].join("\n"),
  },
};

const ifNode = {
  id: "if1",
  name: "Has Failures?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [960, 304],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [
        { id: "c1", leftValue: "={{ $json.hasFailures }}", rightValue: true, operator: { type: "boolean", operation: "equals" } },
      ],
      combinator: "and",
    },
  },
};

const alertNode = {
  id: "tg",
  name: "Alert",
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: [1216, 192],
  parameters: {
    chatId: "707213038",
    text: "=⚠️ <b>n8n Failure Alert</b>\n\n{{ $json.summary }}\n\n⏰ {{ $json.checkedAt }}",
    additionalFields: { parse_mode: "HTML", appendAttribution: false },
  },
  credentials: { telegramApi: CRED.telegramApi },
  onError: "continueRegularOutput",
  alwaysOutputData: true,
};

const logFindings = {
  id: "log",
  name: "Log Findings",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1472, 304],
  parameters: {
    method: "POST",
    url: `${SUPABASE_URL}/rest/v1/automation_logs`,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "supabaseApi",
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({" +
      " workflow_name: 'workflow-failure-sentinel'," +
      " event_name: 'failure.check'," +
      " status: $json.hasFailures ? 'failed' : 'succeeded'," +
      " error_message: $json.hasFailures ? $json.summary : null," +
      " payload_json: { count: $json.count, summary: $json.summary, offenders: $json.offenders || null, error: $json.error || false }," +
      " started_at: $json.checkedAt," +
      " finished_at: new Date().toISOString()" +
      " }) }}",
    options: { response: { response: { neverError: true } } },
  },
  credentials: { supabaseApi: CRED.supabaseApi },
  alwaysOutputData: true,
};

const newNodes = [trigger, logRun, fetchFailures, aggregate, ifNode, alertNode, logFindings];

const newConnections = {
  "Every 15 Min": {
    main: [[
      { node: "Fetch Recent Failures", type: "main", index: 0 },
      { node: "Log Run", type: "main", index: 0 },
    ]],
  },
  "Fetch Recent Failures": { main: [[{ node: "Aggregate", type: "main", index: 0 }]] },
  Aggregate: { main: [[{ node: "Has Failures?", type: "main", index: 0 }]] },
  "Has Failures?": {
    main: [
      [{ node: "Alert", type: "main", index: 0 }],
      [{ node: "Log Findings", type: "main", index: 0 }],
    ],
  },
  Alert: { main: [[{ node: "Log Findings", type: "main", index: 0 }]] },
};

const payload = {
  name: wf.name,
  nodes: newNodes,
  connections: newConnections,
  settings: safeSettings(wf.settings),
};

const result = await putWorkflow(WORKFLOW_ID, payload);
console.log("PUT ok — new versionId:", result.versionId);
console.log("Done. Next sentinel fire (~15 min) hits Supabase instead of n8n REST.");

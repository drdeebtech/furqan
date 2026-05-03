// Repair furqan-workflow-failure-sentinel: the Code node uses the deprecated
// `$http.request` API which silently throws — every fire ends up in the catch
// branch and writes status='skipped' to automation_logs (192/192 over 48h).
//
// Fix:
//   1. Replace `$http.request` with native `fetch()` (works in n8n Code nodes
//      on Node.js 18+).
//   2. Make the Log node's status reflect actual outcome:
//        hasFailures=true  → status='failed'  (sentinel detected failures)
//        hasFailures=false → status='succeeded' (sentinel ran clean)
//   3. Add error_message field when failures are found so the row is
//      diagnostic on its own.
//
// Out of scope for this fix:
//   - Hardcoded n8n API JWT in the jsCode (security debt; tracked as P0-2 in
//     prior plan, requires Supabase dashboard work to rotate properly).
import { getWorkflow, putWorkflow, safeSettings, CRED, SUPABASE_URL } from "./lib.mjs";

const WORKFLOW_ID = "9fCxICrhtSNgFmYt";

const wf = await getWorkflow(WORKFLOW_ID);
console.log("Reading sentinel — versionId:", wf.versionId, "nodeCount:", wf.nodes.length);

// Locate the two nodes we need to rewrite.
const checkNode = wf.nodes.find((n) => n.name === "Check Failures");
const logNode = wf.nodes.find((n) => n.name === "Log");
if (!checkNode || !logNode) {
  console.error("Expected nodes 'Check Failures' and 'Log' not found");
  process.exit(1);
}

// Preserve the existing JWT — pull it out of the current jsCode so we don't
// have to re-paste it (avoids handling the secret in this script's args).
const oldCode = checkNode.parameters.jsCode || "";
const jwtMatch = oldCode.match(/const apiKey = "([^"]+)";/);
if (!jwtMatch) {
  console.error("Could not locate apiKey in existing jsCode");
  process.exit(1);
}
const apiKey = jwtMatch[1];

const newCheckCode = [
  `const apiKey = ${JSON.stringify(apiKey)};`,
  "const now = new Date();",
  "const checkedAt = now.toISOString();",
  "",
  "try {",
  "  const res = await fetch('http://localhost:5678/api/v1/executions?status=error&limit=20', {",
  "    headers: { 'X-N8N-API-KEY': apiKey },",
  "  });",
  "  if (!res.ok) {",
  "    return [{ json: { hasFailures: false, count: 0, summary: 'n8n API returned ' + res.status, checkedAt, error: true } }];",
  "  }",
  "  const data = await res.json();",
  "  const execs = data.data || [];",
  "  const fifteenMinAgo = new Date(now.getTime() - 15 * 60000);",
  "  const recent = execs.filter((e) => {",
  "    const t = new Date(e.stoppedAt || e.startedAt);",
  "    return t >= fifteenMinAgo;",
  "  });",
  "  if (recent.length === 0) {",
  "    return [{ json: { hasFailures: false, count: 0, summary: 'No failures in last 15 min', checkedAt } }];",
  "  }",
  "  const summary = recent.length + ' failed execution(s) in last 15 min';",
  "  const offenders = recent.slice(0, 5).map((e) => ({ id: e.id, workflowId: e.workflowId, stoppedAt: e.stoppedAt })); ",
  "  return [{ json: { hasFailures: true, count: recent.length, summary, offenders, checkedAt } }];",
  "} catch (e) {",
  "  return [{ json: { hasFailures: false, count: 0, summary: 'Check failed: ' + (e && e.message ? e.message : String(e)), checkedAt, error: true } }];",
  "}",
].join("\n");

// Compose the new jsonBody — fixes the inverted status semantics.
//   hasFailures=true  → status='failed'  + error_message set
//   hasFailures=false → status='succeeded' + payload_json captures the clean run
const newLogBody =
  "={{ JSON.stringify({" +
  " workflow_name: 'workflow-failure-sentinel'," +
  " event_name: 'failure.check'," +
  " status: $json.hasFailures ? 'failed' : 'succeeded'," +
  " error_message: $json.hasFailures ? $json.summary : null," +
  " payload_json: { count: $json.count, summary: $json.summary, offenders: $json.offenders || null, error: $json.error || false }," +
  " started_at: $json.checkedAt," +
  " finished_at: new Date().toISOString()" +
  " }) }}";

const newNodes = wf.nodes.map((n) => {
  if (n.name === "Check Failures") {
    return { ...n, parameters: { ...n.parameters, jsCode: newCheckCode } };
  }
  if (n.name === "Log") {
    return {
      ...n,
      parameters: { ...n.parameters, jsonBody: newLogBody },
      credentials: { supabaseApi: CRED.supabaseApi },
    };
  }
  // Re-bind credentials on other HTTP / Telegram nodes that the bulk run
  // already touched, so this PUT doesn't accidentally clear them.
  if (n.type === "n8n-nodes-base.httpRequest") {
    if (n.parameters?.nodeCredentialType === "supabaseApi") {
      return { ...n, credentials: { supabaseApi: CRED.supabaseApi } };
    }
  }
  if (n.type === "n8n-nodes-base.telegram") {
    return { ...n, credentials: { telegramApi: CRED.telegramApi } };
  }
  return n;
});

const payload = {
  name: wf.name,
  nodes: newNodes,
  connections: wf.connections,
  settings: safeSettings(wf.settings),
};

const result = await putWorkflow(WORKFLOW_ID, payload);
console.log("PUT ok — new versionId:", result.versionId);
console.log("Done. Next sentinel fire (~15 min) will use the new logic.");

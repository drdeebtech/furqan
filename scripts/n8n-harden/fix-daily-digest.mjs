// Repair furqan-daily-admin-digest's "Build Digest" Code node.
//
// Bug: the existing readSrc helper assumed `$items(nodeName)[0].json` would
// be the raw HTTP response array (e.g., `[{id:1},{id:2}]`). But n8n's HTTP
// Request node splits arrays into individual items by default — so a 3-row
// response becomes 3 items, each with `items[i].json = {single_row}`. The
// old code's `Array.isArray(j)` check therefore always returned false on
// non-empty responses, falling through to "unexpected response shape".
//
// Fix: rewrite readSrc to handle all three shapes n8n can deliver:
//   1. items.length === 0           → empty result, ok=true
//   2. items[0].json is an Array    → array-as-single-item (rare), ok=true
//   3. items[0].json is PostgREST error envelope ({message, code}) → ok=false
//   4. otherwise, items.map(i => i.json) → split-into-items (default), ok=true
//
// Verified against direct curl replays of the workflow's 4 Supabase queries:
// all return arrays. The bug was never schema; it was always n8n shape parsing.
import { getWorkflow, putWorkflow, safeSettings } from "./lib.mjs";

const WORKFLOW_ID = "1aV0FOmaNuHbVVMj";

const wf = await getWorkflow(WORKFLOW_ID);
console.log("Reading daily-admin-digest — versionId:", wf.versionId, "nodeCount:", wf.nodes.length);

const buildDigestIdx = wf.nodes.findIndex((n) => n.name === "Build Digest");
if (buildDigestIdx === -1) {
  console.error("Build Digest node not found — aborting");
  process.exit(1);
}

const newJsCode = `
function readSrc(nodeName) {
  try {
    const items = $items(nodeName);
    if (!items || items.length === 0) return { ok: true, data: [] };
    const first = items[0].json;
    if (Array.isArray(first)) return { ok: true, data: first };
    if (first && typeof first === "object" && typeof first.message === "string" && typeof first.code === "string") {
      return { ok: false, data: [], err: first.message.slice(0, 200) };
    }
    const data = items.map(i => i.json).filter(j => j != null && typeof j === "object" && !Array.isArray(j));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, data: [], err: (e && e.message) ? e.message : String(e) };
  }
}
const dates = $items("Calculate Yesterday")[0].json;
const bk = readSrc("Fetch Yesterday Bookings");
const pf = readSrc("Fetch New Profiles");
const rv = readSrc("Fetch Revenue");
const fl = readSrc("Fetch Automation Failures");
const errors = [];
if (!bk.ok) errors.push("bookings: " + bk.err);
if (!pf.ok) errors.push("profiles: " + pf.err);
if (!rv.ok) errors.push("revenue: " + rv.err);
if (!fl.ok) errors.push("failures: " + fl.err);
const hadErrors = errors.length > 0;
const bookingArr = bk.data;
const profileArr = pf.data;
const revenueArr = rv.data;
const failureArr = fl.data;
const total = bookingArr.length;
const completed = bookingArr.filter(b => b.status === "completed").length;
const cancelled = bookingArr.filter(b => b.status === "cancelled").length;
const noShow = bookingArr.filter(b => b.status === "no_show").length;
const newStudents = profileArr.filter(p => p.role === "student").length;
const newTeachers = profileArr.filter(p => p.role === "teacher").length;
const totalRevenue = revenueArr.reduce((s, p) => s + (p.amount_usd || 0), 0);
const failureCount = failureArr.length;
let msg = "Daily report - " + dates.dateLabel + "\\n";
msg += "Sessions: " + total + " (done " + completed + " / cancel " + cancelled + " / noshow " + noShow + ")\\n";
msg += "New: students " + newStudents + " / teachers " + newTeachers + "\\n";
msg += "Revenue: " + totalRevenue + "\\n";
msg += "Failures: " + failureCount;
if (failureCount > 0) {
  msg += "\\n";
  failureArr.slice(0, 5).forEach(f => {
    msg += "  - " + f.workflow_name + ": " + (f.error_message || "No details") + "\\n";
  });
}
if (hadErrors) {
  msg += "\\nPartial data due to errors:\\n";
  errors.forEach(e => { msg += "  - " + e + "\\n"; });
}
return [{ json: { msg, had_errors: hadErrors, error_summary: hadErrors ? errors.join("; ") : null, started_at: dates.startedAt } }];
`.trim();

// Smoke-test the readSrc logic locally before pushing to n8n.
const testReadSrc = (items) => {
  const first = items[0]?.json;
  if (!items || items.length === 0) return { ok: true, data: [] };
  if (Array.isArray(first)) return { ok: true, data: first };
  if (first && typeof first === "object" && typeof first.message === "string" && typeof first.code === "string") {
    return { ok: false, data: [], err: first.message.slice(0, 200) };
  }
  return { ok: true, data: items.map(i => i.json).filter(j => j != null && typeof j === "object" && !Array.isArray(j)) };
};
const cases = [
  ["empty", [], { ok: true, len: 0 }],
  ["split rows", [{ json: { id: 1, status: "completed" } }, { json: { id: 2, status: "no_show" } }], { ok: true, len: 2 }],
  ["array-as-item", [{ json: [{ id: 1 }, { id: 2 }] }], { ok: true, len: 2 }],
  ["pg error", [{ json: { message: "column does not exist", code: "42703" } }], { ok: false, len: 0 }],
  ["single row", [{ json: { id: 5, role: "student" } }], { ok: true, len: 1 }],
];
let pass = 0;
for (const [label, input, want] of cases) {
  const got = testReadSrc(input);
  const ok = got.ok === want.ok && got.data.length === want.len;
  console.log(`  smoke ${ok ? "OK" : "FAIL"}: ${label} → ok=${got.ok} len=${got.data.length}`);
  if (ok) pass++;
}
if (pass !== cases.length) {
  console.error(`Smoke tests failed (${pass}/${cases.length}) — aborting`);
  process.exit(1);
}
console.log(`Smoke tests passed: ${pass}/${cases.length}`);

const newNodes = wf.nodes.map((n, i) => i === buildDigestIdx
  ? { ...n, parameters: { ...n.parameters, jsCode: newJsCode } }
  : n);

const payload = {
  name: wf.name,
  nodes: newNodes,
  connections: wf.connections,
  settings: safeSettings(wf.settings),
};

const result = await putWorkflow(WORKFLOW_ID, payload);
console.log("PUT ok — new versionId:", result.versionId);
console.log("Done. Next 24h fire (or manual trigger) will use the corrected readSrc.");

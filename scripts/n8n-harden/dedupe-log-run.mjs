// Remove duplicate "Log Run" nodes from the 5 new cron workflows.
// applyHardening() pushed a Log Run unconditionally; fix-cron-creds.mjs had
// already added one — so each of those 5 workflows now has two. The trigger
// connection only wires to the first match by name, so the second is orphaned.
import { getWorkflow, putWorkflow, safeSettings } from "./lib.mjs";

const TARGETS = [
  "9HJZmdeLsaUKgZC0", // cron-auto-complete-sessions
  "ezrnzox3Awy4pGMy", // cron-cache-clear
  "ucQUFb31nnQY0brM", // cron-handoff-cleanup
  "ddPFuoV80kGo0mkT", // cron-murajaah-due
  "RvOlWJygNON7R53Q", // cron-n8n-healthcheck
];

for (const id of TARGETS) {
  const wf = await getWorkflow(id);
  const logRuns = wf.nodes.filter((n) => n.name === "Log Run");
  if (logRuns.length <= 1) {
    console.log(`✓ ${id}: ${logRuns.length} Log Run node(s) — no dedupe needed`);
    continue;
  }
  // Keep the first; drop subsequent duplicates.
  const [keep, ...drop] = logRuns;
  const dropSet = new Set(drop);
  const newNodes = wf.nodes.filter((n) => !dropSet.has(n));
  const payload = {
    name: wf.name,
    nodes: newNodes,
    connections: wf.connections,
    settings: safeSettings(wf.settings),
  };
  const out = await putWorkflow(id, payload);
  const remaining = out.nodes.filter((n) => n.name === "Log Run").length;
  console.log(`✓ ${id}: dropped ${drop.length} duplicate Log Run node(s) — kept position [${keep.position}], now ${remaining} Log Run`);
}
console.log("\nDone.");

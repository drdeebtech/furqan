// Diff live n8n workflows against AUTOMATION_REGISTRY.md.
// Output: Markdown with 4 sections (registered+live, registered+missing,
// live+unregistered, naming violations). Byte-deterministic across runs at
// same n8n state (FR-002).
//
// Usage: node scripts/n8n-audit.mjs > /tmp/n8n-audit.md
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

import { listWorkflows, SUPABASE_URL } from "./n8n-harden/lib.mjs";

// Parse AUTOMATION_REGISTRY.md to extract all registered workflow slugs.
// Matches lines like: ### WF-NN furqan-<slug>
function parseRegistry() {
  const content = readFileSync(resolve("AUTOMATION_REGISTRY.md"), "utf8");
  const slugs = new Set();
  for (const match of content.matchAll(/^### WF-\d+\s+(furqan-[\w-]+)/gm)) {
    slugs.add(match[1]);
  }
  return slugs;
}

// Fetch the most recent automation_logs row per workflow slug.
// Returns { [slug]: ISO-timestamp | null }
async function fetchLastFires(slugSet) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    process.stderr.write("[audit] SUPABASE_SERVICE_ROLE_KEY not set — skipping last-fire lookup\n");
    return {};
  }
  const url = `${SUPABASE_URL}/rest/v1/automation_logs?select=workflow_name,started_at&order=started_at.desc&limit=1000`;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    process.stderr.write(`[audit] automation_logs query failed: ${res.status}\n`);
    return {};
  }
  const rows = await res.json();
  const result = {};
  for (const row of rows) {
    if (slugSet.has(row.workflow_name) && !result[row.workflow_name]) {
      result[row.workflow_name] = row.started_at;
    }
  }
  return result;
}

// Validate against the kebab-case convention (FR-012):
// All live furqan- workflows must match this pattern.
function isValidSlug(name) {
  return /^furqan-[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

const now = new Date().toISOString();

// 1. Fetch live workflows from n8n REST API.
const liveWorkflows = await listWorkflows();
const liveNames = new Set(liveWorkflows.map((w) => w.name));

// 2. Parse registered slugs from AUTOMATION_REGISTRY.md.
const registeredSlugs = parseRegistry();

// 3. Compute set intersections / differences.
const bothSlugs    = [...registeredSlugs].filter((s) => liveNames.has(s)).sort();
const regOnlySlugs = [...registeredSlugs].filter((s) => !liveNames.has(s)).sort();
// Only count furqan- prefixed live workflows in the unregistered set.
const liveOnlySlugs = [...liveNames]
  .filter((n) => n.startsWith("furqan-") && !registeredSlugs.has(n))
  .sort();

// 4. Fetch last-fire timestamps for registered+live set.
const lastFires = await fetchLastFires(new Set(bothSlugs));

// 5. Detect naming violations among all live workflows.
const namingViolations = liveWorkflows
  .map((w) => w.name)
  .filter((n) => !isValidSlug(n))
  .sort();

// 6. Render deterministic Markdown report.
const lines = [
  `# n8n Audit — ${now}`,
  "",
  `## Registered + Live (${bothSlugs.length})`,
  "",
  ...bothSlugs.map((s) => {
    const ts = lastFires[s] ?? null;
    return `- ${s}  _(last fire: ${ts ?? "no logs"})_`;
  }),
  "",
  `## Registered + Missing (${regOnlySlugs.length})`,
  "",
  ...(regOnlySlugs.length > 0
    ? regOnlySlugs.map((s) => `- ${s}`)
    : ["_None_"]),
  "",
  `## Live + Unregistered (${liveOnlySlugs.length})`,
  "",
  ...(liveOnlySlugs.length > 0
    ? liveOnlySlugs.map((s) => `- ${s}`)
    : ["_None_"]),
  "",
  `## Naming Violations (${namingViolations.length})`,
  "",
  ...(namingViolations.length === 0
    ? ["_None — all live workflows conform to `furqan-[a-z0-9]+(-[a-z0-9]+)*`._"]
    : [
        "Pattern enforced: `^furqan-[a-z0-9]+(-[a-z0-9]+)*$`",
        "",
        ...namingViolations.map((n) => `- \`${n}\``),
      ]),
];

process.stdout.write(lines.join("\n") + "\n");

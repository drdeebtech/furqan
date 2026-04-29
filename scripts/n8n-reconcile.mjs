#!/usr/bin/env node
/**
 * n8n workflow reconciliation report.
 *
 * Read-only diff between:
 *   - workflows currently active in n8n (live REST API)
 *   - workflow JSON files committed to automation/workflows/
 *
 * Reports:
 *   - in_n8n_only     → workflows that exist on n8n but are NOT backed up
 *   - in_git_only     → JSON files for workflows that no longer exist in n8n
 *   - matched         → present on both sides
 *
 * Exit codes:
 *   0 — fully reconciled
 *   1 — drift detected (in_n8n_only or in_git_only non-empty)
 *   2 — failed to query n8n
 *
 * Usage:
 *   N8N_API_URL=https://n8n.drdeeb.tech/api/v1 \
 *   N8N_API_KEY=<key> \
 *   node scripts/n8n-reconcile.mjs
 */

import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const WF_DIR = join(REPO_ROOT, "automation", "workflows");

const N8N_API_URL = (process.env.N8N_API_URL ?? "").trim().replace(/\/+$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_URL || !N8N_API_KEY) {
  console.error("[reconcile] N8N_API_URL and N8N_API_KEY must be set");
  process.exit(2);
}

async function main() {
  let deployed;
  try {
    const res = await fetch(`${N8N_API_URL}/workflows?limit=250`, {
      headers: { "X-N8N-API-KEY": N8N_API_KEY },
    });
    if (!res.ok) {
      console.error(`[reconcile] n8n API ${res.status}: ${await res.text().catch(() => "")}`);
      process.exit(2);
    }
    deployed = (await res.json()).data ?? [];
  } catch (err) {
    console.error(`[reconcile] n8n unreachable: ${err.message ?? err}`);
    process.exit(2);
  }

  const deployedIds = new Map(deployed.map((w) => [w.id, w.name]));

  const files = (await readdir(WF_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  const fileIds = new Map();
  for (const f of files) {
    // filename format: <id>__<slug>.json
    const id = f.split("__")[0];
    fileIds.set(id, f);
  }

  const inN8nOnly = [];
  const inGitOnly = [];
  const matched = [];

  for (const [id, name] of deployedIds) {
    if (fileIds.has(id)) matched.push({ id, name });
    else inN8nOnly.push({ id, name });
  }
  for (const [id, file] of fileIds) {
    if (!deployedIds.has(id)) inGitOnly.push({ id, file });
  }

  console.log(`\n[reconcile] deployed=${deployed.length}, files=${files.length}, matched=${matched.length}\n`);

  if (inN8nOnly.length === 0 && inGitOnly.length === 0) {
    console.log("✓ fully reconciled — every deployed workflow has a JSON backup\n");
    return;
  }

  if (inN8nOnly.length > 0) {
    console.log(`⚠ ${inN8nOnly.length} workflows in n8n but NOT backed up:`);
    for (const { id, name } of inN8nOnly) console.log(`    - ${id}  ${name}`);
    console.log("  → run: node scripts/n8n-export.mjs --commit\n");
  }

  if (inGitOnly.length > 0) {
    console.log(`⚠ ${inGitOnly.length} JSON files for workflows no longer in n8n:`);
    for (const { id, file } of inGitOnly) console.log(`    - ${id}  ${file}`);
    console.log("  → these will be pruned automatically by the next export run\n");
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(`[reconcile] crashed: ${err.message ?? err}`);
  process.exit(2);
});

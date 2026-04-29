#!/usr/bin/env node
/**
 * n8n workflow JSON exporter.
 *
 * Fetches every workflow from the n8n REST API and writes one JSON file per
 * workflow to automation/workflows/. Intended to run nightly on the Mac mini
 * via cron so the workflow definitions are version-controlled in git — if the
 * Mac mini disk dies, we can restore from GitHub.
 *
 * Usage:
 *   N8N_API_URL=https://n8n.drdeeb.tech/api/v1 \
 *   N8N_API_KEY=<key> \
 *   node scripts/n8n-export.mjs              # write files only
 *   node scripts/n8n-export.mjs --commit     # also git add + commit + push
 *
 * Cron suggestion (Mac mini, nightly at 03:30 local):
 *   30 3 * * *  cd /path/to/furqan && node scripts/n8n-export.mjs --commit
 */

import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "automation", "workflows");

const N8N_API_URL = (process.env.N8N_API_URL ?? "").trim().replace(/\/+$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY;
const SHOULD_COMMIT = process.argv.includes("--commit");

if (!N8N_API_URL) die("N8N_API_URL not set");
if (!N8N_API_KEY) die("N8N_API_KEY not set");

function die(msg) {
  console.error(`[n8n-export] ${msg}`);
  process.exit(1);
}

async function n8nFetch(path) {
  const res = await fetch(`${N8N_API_URL}${path}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) die(`n8n API ${res.status} on ${path}: ${await res.text().catch(() => "")}`);
  return res.json();
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const list = await n8nFetch("/workflows?limit=250");
  const workflows = list.data ?? [];
  console.log(`[n8n-export] found ${workflows.length} workflows`);

  // Track files we wrote so we can prune workflows that were deleted on the
  // n8n side (otherwise old JSON files linger forever in git).
  const written = new Set();

  for (const wf of workflows) {
    const detail = await n8nFetch(`/workflows/${wf.id}`);
    // Drop volatile fields that change every fetch and produce noisy diffs
    // without semantic meaning. updatedAt churns even on no-op opens.
    const { updatedAt, versionId, ...stable } = detail;
    void updatedAt;
    void versionId;
    const filename = `${wf.id}__${slugify(wf.name)}.json`;
    written.add(filename);
    const filePath = join(OUT_DIR, filename);
    await writeFile(filePath, JSON.stringify(stable, null, 2) + "\n");
    console.log(`  ✓ ${filename}`);
  }

  // Prune: any file in automation/workflows/ that is NOT in `written`
  // corresponds to a workflow that was deleted in n8n. Remove it so git
  // history reflects the deletion.
  const existing = await readdir(OUT_DIR).catch(() => []);
  let pruned = 0;
  for (const f of existing) {
    if (!f.endsWith(".json")) continue;
    if (!written.has(f)) {
      await unlink(join(OUT_DIR, f));
      console.log(`  ✗ pruned ${f}`);
      pruned++;
    }
  }

  console.log(`[n8n-export] wrote ${written.size}, pruned ${pruned}`);

  if (SHOULD_COMMIT) {
    await commitAndPush(written.size, pruned);
  }
}

async function commitAndPush(writtenCount, prunedCount) {
  try {
    await exec("git", ["add", "automation/workflows/"], { cwd: REPO_ROOT });
    // Check if anything actually changed — avoid empty commits on no-op runs.
    const { stdout } = await exec("git", ["status", "--porcelain", "automation/workflows/"], { cwd: REPO_ROOT });
    if (!stdout.trim()) {
      console.log("[n8n-export] no changes to commit");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const msg = `chore(n8n): export workflows ${date} (${writtenCount} active${prunedCount ? `, ${prunedCount} pruned` : ""})`;
    await exec("git", ["commit", "-m", msg], { cwd: REPO_ROOT });
    await exec("git", ["push"], { cwd: REPO_ROOT });
    console.log(`[n8n-export] committed + pushed: ${msg}`);
  } catch (err) {
    die(`git ops failed: ${err.message ?? err}`);
  }
}

main().catch((err) => die(err.message ?? String(err)));

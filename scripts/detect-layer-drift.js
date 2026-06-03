#!/usr/bin/env node
/**
 * Layer drift detection — warns when files in the repo are not indexed
 * in the knowledge graph. Run after large refactors or file additions.
 *
 * Usage:
 *   node scripts/detect-layer-drift.js [--changed-only]
 *
 *   --changed-only: Only check files in `git diff --name-only origin/main...HEAD`
 *                   (fast path for PR CI)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const GRAPH_PATH = path.join(ROOT, ".understand-anything", "knowledge-graph.json");

if (!fs.existsSync(GRAPH_PATH)) {
  console.log("No knowledge graph found — skipping drift detection.");
  process.exit(0);
}

const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf-8"));
const nodes = graph.nodes ?? [];

// Build set of all file paths indexed in the graph
const indexedPaths = new Set(
  nodes
    .filter((n) => n.type === "file" && n.filePath)
    .map((n) => n.filePath.replace(/^\//, "")) // strip leading slash
);

// Get files to check
const changedOnly = process.argv.includes("--changed-only");
let filesToCheck;

if (changedOnly) {
  try {
    const diff = execSync("git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD", {
      cwd: ROOT,
      encoding: "utf-8",
    });
    filesToCheck = diff.trim().split("\n").filter(Boolean);
  } catch {
    filesToCheck = [];
  }
} else {
  try {
    const listed = execSync("git ls-files src/", { cwd: ROOT, encoding: "utf-8" });
    filesToCheck = listed.trim().split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  } catch {
    filesToCheck = [];
  }
}

// Filter to TypeScript source files only
const srcFiles = filesToCheck.filter(
  (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test.")
);

const unindexed = srcFiles.filter((f) => !indexedPaths.has(f));

if (unindexed.length === 0) {
  console.log("✅ No layer drift — all checked files are indexed in the knowledge graph.");
  process.exit(0);
}

console.log(`⚠️  ${unindexed.length} file(s) not indexed in knowledge-graph.json:\n`);
for (const f of unindexed) {
  console.log(`  ${f}`);
}

if (changedOnly) {
  console.log(
    "\nThis PR adds or modifies files not yet in the knowledge graph."
  );
  console.log("Run `/understand --full` and commit the updated graph to keep AI context accurate.");
} else {
  console.log(
    "\nRun `/understand --full` to regenerate the knowledge graph with these files included."
  );
}

// Warning only — don't fail CI on drift (graph update is async)
process.exit(0);

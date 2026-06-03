#!/usr/bin/env node
// coupling-guard.js — warn when high-coupling files are changed in a PR.
// Usage:
//   node scripts/coupling-guard.js src/lib/supabase/server.ts src/lib/logger.ts
//   CHANGED_FILES="src/lib/supabase/server.ts src/lib/logger.ts" node scripts/coupling-guard.js
// Exit 0 always — this is advisory, never a blocker.

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const THRESHOLD_CRITICAL = 100;
const THRESHOLD_HIGH     = 50;
const THRESHOLD_MEDIUM   = 20;

const GRAPH_PATH = path.join(
  __dirname,
  '..',
  '.understand-anything',
  'knowledge-graph.json'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip leading ./ or / so paths match the graph's filePath keys. */
function normalisePath(p) {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Collect changed file paths from CLI args and/or CHANGED_FILES env var. */
function collectChangedFiles() {
  const fromArgs = process.argv.slice(2).map(normalisePath).filter(Boolean);

  // Support both newline-separated (env from `cat file`) and space-separated.
  const fromEnv = (process.env.CHANGED_FILES || '')
    .split(/[\n ]/)
    .map(l => normalisePath(l.trim()))
    .filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const f of [...fromArgs, ...fromEnv]) {
    if (!seen.has(f)) {
      seen.add(f);
      result.push(f);
    }
  }
  return result;
}

/**
 * Build a map of fileNodeId → importer count.
 * An "import" edge is: { source: A, target: B, type: "imports" }
 * meaning A imports B. We count how many A's point at each B.
 */
function buildImporterCounts(edges) {
  const counts = new Map(); // targetId → count
  for (const edge of edges) {
    if (edge.type !== 'imports') continue;
    const { target } = edge;
    if (!target) continue;
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  return counts;
}

function levelLabel(count) {
  if (count >= THRESHOLD_CRITICAL) return 'CRITICAL';
  if (count >= THRESHOLD_HIGH)     return 'HIGH';
  if (count >= THRESHOLD_MEDIUM)   return 'MEDIUM';
  return null;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(changedFiles, importerCounts) {
  // For each changed file, look up its importer count.
  const flagged = [];

  for (const fp of changedFiles) {
    const nodeId = `file:${fp}`;
    const count = importerCounts.get(nodeId) || 0;
    if (count >= THRESHOLD_MEDIUM) {
      flagged.push({ fp, count, level: levelLabel(count) });
    }
  }

  if (flagged.length === 0) {
    return null; // nothing to report
  }

  // Sort by count descending.
  flagged.sort((a, b) => b.count - a.count);

  const critical = flagged.filter(f => f.level === 'CRITICAL');
  const high     = flagged.filter(f => f.level === 'HIGH');
  const medium   = flagged.filter(f => f.level === 'MEDIUM');

  const lines = [];
  lines.push('⚠️  HIGH-COUPLING FILE CHANGED');
  lines.push('');

  for (const { fp, count } of flagged) {
    lines.push(`  ${fp}`);
    lines.push(`    • ${count} files import this`);
    lines.push(`    • A bug here would break ${count} source files`);
    lines.push(`    • Ensure: tests pass, no breaking interface changes`);
    lines.push('');
  }

  lines.push('Impact levels:');
  if (critical.length > 0) {
    lines.push(`  CRITICAL (${THRESHOLD_CRITICAL}+):    ${critical.map(f => f.fp).join(', ')}`);
  }
  if (high.length > 0) {
    lines.push(`  HIGH     (${THRESHOLD_HIGH}-${THRESHOLD_CRITICAL - 1}):  ${high.map(f => f.fp).join(', ')}`);
  }
  if (medium.length > 0) {
    lines.push(`  MEDIUM   (${THRESHOLD_MEDIUM}-${THRESHOLD_HIGH - 1}):  ${medium.map(f => f.fp).join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.log('No knowledge graph — skipping coupling check.');
    process.exit(0);
  }

  const changedFiles = collectChangedFiles();

  if (changedFiles.length === 0) {
    console.log('No changed files provided — skipping coupling check.');
    process.exit(0);
  }

  let graph;
  try {
    const raw = fs.readFileSync(GRAPH_PATH, 'utf8');
    graph = JSON.parse(raw);
  } catch (err) {
    console.log(`coupling-guard: failed to parse knowledge graph (${err.message}) — skipping.`);
    process.exit(0);
  }

  const edges = graph.edges || [];
  const importerCounts = buildImporterCounts(edges);

  const report = buildReport(changedFiles, importerCounts);

  if (report) {
    console.log(report);
  } else {
    console.log('✅ No high-coupling files changed.');
  }

  process.exit(0);
}

main();

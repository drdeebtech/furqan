#!/usr/bin/env node
// pr-impact.js — PR blast-radius analysis from the understand-anything knowledge graph.
// Usage:
//   node scripts/pr-impact.js src/foo.ts src/bar.ts
//   CHANGED_FILES="src/foo.ts\nsrc/bar.ts" node scripts/pr-impact.js
// Exit 0 always — this is a reporter, never a blocker.

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const GRAPH_PATH = path.join(__dirname, '..', '.understand-anything', 'knowledge-graph.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a raw path string to the form stored in node filePath fields. */
function normalisePath(p) {
  // Strip leading ./ or / so we get "src/foo.ts" style keys.
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Collect changed file paths from CLI args + CHANGED_FILES env var. */
function collectChangedFiles() {
  const fromArgs = process.argv.slice(2).map(normalisePath).filter(Boolean);

  const fromEnv = (process.env.CHANGED_FILES || '')
    .split('\n')
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

/** Return the layer name for a node id, or 'Unknown Layer'. */
function buildLayerMap(layers) {
  const map = new Map();
  for (const layer of layers) {
    for (const nodeId of layer.nodeIds || []) {
      map.set(nodeId, layer.name);
    }
  }
  return map;
}

/**
 * Given the set of "upstream dependents" edges (source → target means
 * source imports/depends-on target), build a reverse index so we can
 * quickly answer "who depends on X?".
 *
 * Edges in the graph are stored as:
 *   { source: "file:A", target: "file:B", type: "imports", direction: "forward" }
 * meaning A imports B.  We want to know: for a changed node X, who imports X?
 * That means we want all edges where target === X.
 */
function buildDependantsIndex(edges) {
  const index = new Map(); // targetId → Set of sourceIds
  for (const edge of edges) {
    const { source, target } = edge;
    if (!source || !target) continue;
    let set = index.get(target);
    if (!set) {
      set = new Set();
      index.set(target, set);
    }
    set.add(source);
  }
  return index;
}

/**
 * Trace upstream dependants up to `maxHops` hops.
 * Returns a Map<nodeId, hop> for all nodes reachable upstream.
 */
function traceUpstream(startIds, dependantsIndex, maxHops) {
  const visited = new Map(); // nodeId → hop distance (1-indexed)
  const queue = startIds.map(id => ({ id, hop: 0 }));

  while (queue.length > 0) {
    const { id, hop } = queue.shift();
    if (hop > maxHops) continue;

    const dependants = dependantsIndex.get(id) || new Set();
    for (const dep of dependants) {
      if (!visited.has(dep)) {
        const nextHop = hop + 1;
        visited.set(dep, nextHop);
        if (nextHop < maxHops) {
          queue.push({ id: dep, hop: nextHop });
        }
      }
    }
  }

  return visited;
}

/** Detect if a file path looks like a DB migration. */
function isMigration(filePath) {
  return /supabase[/\\]migrations[/\\]/.test(filePath);
}

/** Given a migration file path, find table nodes that belong to it. */
function tablesForMigration(filePath, nodes) {
  return nodes
    .filter(n => n.type === 'table' && n.filePath === filePath)
    .map(n => n.name);
}

/** Friendly display name — strip the "file:" prefix. */
function displayId(nodeId) {
  return nodeId.replace(/^file:/, '');
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(changedFiles, graph) {
  const { nodes, edges, layers } = graph;

  const layerMap = buildLayerMap(layers || []);
  const dependantsIndex = buildDependantsIndex(edges || []);

  // Build a map from filePath → node for quick lookup.
  const nodeByPath = new Map();
  for (const node of nodes || []) {
    if (node.filePath) {
      // There can be multiple nodes per file (file node + function nodes etc.).
      // Prefer the "file" type node for the primary row.
      const existing = nodeByPath.get(node.filePath);
      if (!existing || node.type === 'file') {
        nodeByPath.set(node.filePath, node);
      }
    }
  }

  // Also build a map from nodeId → node for hop-2 label lookups.
  const nodeById = new Map();
  for (const node of nodes || []) {
    nodeById.set(node.id, node);
  }

  // For each changed file find its file-node id.
  const changedNodeIds = [];
  const matchedFiles = [];
  const unmatchedFiles = [];

  for (const fp of changedFiles) {
    const node = nodeByPath.get(fp);
    if (node) {
      changedNodeIds.push(`file:${fp}`);
      matchedFiles.push(fp);
    } else {
      unmatchedFiles.push(fp);
    }
  }

  // Hop-1 dependants per changed file.
  const directDependantsByFile = new Map(); // filePath → Set<nodeId>
  for (const fp of matchedFiles) {
    const nodeId = `file:${fp}`;
    const deps = dependantsIndex.get(nodeId) || new Set();
    directDependantsByFile.set(fp, deps);
  }

  // Full 2-hop blast radius (union across all changed files).
  const blastRadius = traceUpstream(changedNodeIds, dependantsIndex, 2);

  // --- Changed files table rows ---
  const changedRows = [];
  for (const fp of changedFiles) {
    const node = nodeByPath.get(fp);
    const nodeId = `file:${fp}`;
    const layer = node ? (layerMap.get(nodeId) || inferLayer(fp)) : inferLayer(fp);
    const directCount = (directDependantsByFile.get(fp) || new Set()).size;
    changedRows.push({ fp, layer, directCount });
  }

  // --- High-risk files (5+ direct dependants) ---
  const highRisk = changedRows.filter(r => r.directCount >= 5);

  // --- Migrations ---
  const migrationFiles = changedFiles.filter(isMigration);
  const migrationInfo = migrationFiles.map(fp => ({
    fp,
    tables: tablesForMigration(fp, nodes || []),
  }));

  // ---------------------------------------------------------------------------
  // Render Markdown
  // ---------------------------------------------------------------------------
  const lines = [];

  lines.push('## PR Impact Analysis');
  lines.push('');
  lines.push(`**Changed files:** ${changedFiles.length}`);
  lines.push(`**Matched in graph:** ${matchedFiles.length}`);
  lines.push(`**Directly affected nodes:** ${[...directDependantsByFile.values()].reduce((s, v) => s + v.size, 0)}`);
  lines.push(`**Total blast radius (2 hops):** ${blastRadius.size}`);
  lines.push('');

  // Changed files table
  lines.push('### Changed Files');
  lines.push('');
  lines.push('| File | Layer | Direct Dependents |');
  lines.push('|------|-------|-------------------|');
  for (const { fp, layer, directCount } of changedRows) {
    const inGraph = matchedFiles.includes(fp) ? '' : ' _(not in graph)_';
    lines.push(`| \`${fp}\`${inGraph} | ${layer} | ${directCount} |`);
  }
  lines.push('');

  // Unmatched warning
  if (unmatchedFiles.length > 0) {
    lines.push('> **Note:** The following changed files were not found in the knowledge graph');
    lines.push('> (new files, deleted files, or graph may be stale — run `npx understand-anything analyze` to refresh):');
    for (const fp of unmatchedFiles) {
      lines.push(`> - \`${fp}\``);
    }
    lines.push('');
  }

  // High-risk section
  if (highRisk.length > 0) {
    lines.push('### High-Risk Changes (5+ dependents)');
    lines.push('');
    for (const { fp } of highRisk) {
      const deps = [...(directDependantsByFile.get(fp) || [])];
      lines.push(`**\`${fp}\`** — ${deps.length} direct dependent(s):`);
      lines.push('');
      for (const depId of deps) {
        lines.push(`- \`${displayId(depId)}\``);
      }
      lines.push('');
    }
  } else {
    lines.push('### High-Risk Changes');
    lines.push('');
    lines.push('_No files with 5 or more direct dependents._');
    lines.push('');
  }

  // Migrations section
  if (migrationFiles.length > 0) {
    lines.push('### Migrations Detected');
    lines.push('');
    for (const { fp, tables } of migrationInfo) {
      lines.push(`**\`${fp}\`**`);
      if (tables.length > 0) {
        lines.push('');
        lines.push('Affected tables:');
        for (const t of tables) {
          lines.push(`- \`${t}\``);
        }
      } else {
        lines.push(' — no table nodes found in graph (or graph is stale).');
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('_Generated by `scripts/pr-impact.js` from `.understand-anything/knowledge-graph.json`_');

  return lines.join('\n');
}

/** Fallback layer inference from file path when the node isn't in a layer. */
function inferLayer(fp) {
  if (/supabase\/migrations/.test(fp)) return 'Data Layer';
  if (/src\/app\/admin/.test(fp)) return 'Admin Dashboard';
  if (/src\/app\/teacher/.test(fp)) return 'Teacher Dashboard';
  if (/src\/app\/student/.test(fp)) return 'Student Dashboard';
  if (/src\/app\/api/.test(fp)) return 'API Routes';
  if (/src\/lib/.test(fp)) return 'Service & Domain Layer';
  if (/src\/components/.test(fp)) return 'Public & Auth UI';
  if (/\.test\.|\.spec\.|__tests__/.test(fp)) return 'Tests';
  if (/\.github|scripts\//.test(fp)) return 'Infrastructure & CI/CD';
  return 'Unknown Layer';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const changedFiles = collectChangedFiles();

  if (changedFiles.length === 0) {
    console.log('## PR Impact Analysis\n');
    console.log('_No changed files provided. Pass file paths as CLI arguments or set `CHANGED_FILES` env var._');
    process.exit(0);
  }

  if (!fs.existsSync(GRAPH_PATH)) {
    console.log('## PR Impact Analysis\n');
    console.log(`> **Warning:** Knowledge graph not found at \`${GRAPH_PATH}\`.`);
    console.log('> Run `npx understand-anything analyze` to generate it.');
    console.log('');
    console.log(`**Changed files (${changedFiles.length}):**`);
    for (const f of changedFiles) {
      console.log(`- \`${f}\``);
    }
    process.exit(0);
  }

  let graph;
  try {
    const raw = fs.readFileSync(GRAPH_PATH, 'utf8');
    graph = JSON.parse(raw);
  } catch (err) {
    console.log('## PR Impact Analysis\n');
    console.log(`> **Warning:** Failed to parse knowledge graph: ${err.message}`);
    process.exit(0);
  }

  const report = buildReport(changedFiles, graph);
  console.log(report);
  process.exit(0);
}

main();

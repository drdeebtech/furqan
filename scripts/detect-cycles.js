#!/usr/bin/env node
/**
 * Detect import cycles in the knowledge graph.
 * Reads .understand-anything/knowledge-graph.json and reports circular imports.
 * Exit 0 = no cycles. Exit 1 = cycles found.
 */

const fs = require("fs");
const path = require("path");

const GRAPH_PATH = path.join(
  __dirname,
  "..",
  ".understand-anything",
  "knowledge-graph.json"
);

if (!fs.existsSync(GRAPH_PATH)) {
  console.log("No knowledge graph found — skipping cycle detection.");
  process.exit(0);
}

// NOTE: This script detects cycles in the knowledge graph which reflects the
// committed codebase at the time the graph was last rebuilt. New cycles
// introduced in the current branch may not appear until the graph is updated
// via /understand --full.

const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf-8"));
const nodes = graph.nodes ?? [];
const edges = graph.edges ?? [];

// Build adjacency list of import edges (file nodes only)
const fileNodes = new Set(
  nodes.filter((n) => n.type === "file").map((n) => n.id)
);

const adj = {};
for (const n of nodes) {
  if (n.type === "file") adj[n.id] = [];
}

for (const e of edges) {
  if (e.type === "imports" && fileNodes.has(e.source) && fileNodes.has(e.target)) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
}

// DFS cycle detection
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = {};
for (const id of Object.keys(adj)) color[id] = WHITE;

const cycles = [];

function dfs(node, stack) {
  color[node] = GRAY;
  stack.push(node);
  for (const neighbor of (adj[node] ?? [])) {
    if (color[neighbor] === GRAY) {
      // Found a cycle — extract the cycle portion from stack
      const cycleStart = stack.indexOf(neighbor);
      cycles.push(stack.slice(cycleStart).concat(neighbor));
    } else if (color[neighbor] === WHITE) {
      dfs(neighbor, stack);
    }
  }
  stack.pop();
  color[node] = BLACK;
}

for (const id of Object.keys(adj)) {
  if (color[id] === WHITE) dfs(id, []);
}

// Resolve node IDs to human-readable file paths
const idToPath = {};
for (const n of nodes) {
  idToPath[n.id] = n.filePath ?? n.name ?? n.id;
}

if (cycles.length === 0) {
  console.log("✅ No import cycles detected.");
  process.exit(0);
}

console.log(`❌ Found ${cycles.length} import cycle(s):\n`);
for (const [i, cycle] of cycles.entries()) {
  const readable = cycle.map((id) => idToPath[id] ?? id);
  console.log(`  Cycle ${i + 1}: ${readable.join(" → ")}`);
}

console.log(
  "\nFix: extract the shared code into a new module that neither file imports from the other."
);
process.exit(1);

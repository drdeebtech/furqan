#!/usr/bin/env node
/**
 * Creates the daily retention-score cron workflow on n8n.drdeeb.tech
 * and activates it.
 *
 * Requires env (from .env.local or `vercel env pull`):
 *   N8N_API_URL           — e.g. https://n8n.drdeeb.tech/api/v1
 *   N8N_API_KEY           — n8n personal API key
 *   N8N_WEBHOOK_SECRET    — shared secret used by /api/cron/retention-score
 *   NEXT_PUBLIC_APP_URL   — e.g. https://furqan.today
 *
 * Run:
 *   node scripts/create-retention-cron.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Env loading ────────────────────────────────────────────────────────────
function loadDotenv(file) {
  if (!existsSync(file)) return;
  const txt = readFileSync(file, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    // Normalize literal escape sequences and strip trailing whitespace/slashes
    v = v.replace(/\\n|\\r/g, "").replace(/\s+$/, "").replace(/\/+$/, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadDotenv(resolve(process.cwd(), ".env.local"));

const N8N_API_URL = process.env.N8N_API_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://furqan.today";

for (const [k, v] of Object.entries({ N8N_API_URL, N8N_API_KEY, N8N_WEBHOOK_SECRET, APP_URL })) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const WORKFLOW_NAME = "furqan-retention-scorer";
const CRON_EXPRESSION = "0 3 * * *"; // daily 03:00 server time
const TARGET_URL = `${APP_URL.replace(/\/+$/, "")}/api/cron/retention-score`;

// ─── n8n fetch helper ───────────────────────────────────────────────────────
async function n8n(path, init = {}) {
  const res = await fetch(`${N8N_API_URL}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// ─── Workflow spec ──────────────────────────────────────────────────────────
const workflow = {
  name: WORKFLOW_NAME,
  nodes: [
    {
      id: "schedule-1",
      name: "Daily 03:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [260, 300],
      parameters: {
        rule: {
          interval: [{ field: "cronExpression", expression: CRON_EXPRESSION }],
        },
      },
    },
    {
      id: "http-1",
      name: "POST retention-score",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [520, 300],
      parameters: {
        method: "POST",
        url: TARGET_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "X-N8N-Secret", value: N8N_WEBHOOK_SECRET }],
        },
        options: { timeout: 60000 },
      },
    },
  ],
  connections: {
    "Daily 03:00": {
      main: [[{ node: "POST retention-score", type: "main", index: 0 }]],
    },
  },
  settings: { executionOrder: "v1", saveExecutionProgress: true },
};

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  // Check for existing workflow by name
  console.log(`Looking up existing "${WORKFLOW_NAME}"…`);
  const list = await n8n(`/workflows?limit=250`);
  const existing = (list.data || []).find((w) => w.name === WORKFLOW_NAME);

  let created;
  if (existing) {
    console.log(`Found existing id=${existing.id}, updating…`);
    created = await n8n(`/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(workflow),
    });
  } else {
    console.log("Creating new workflow…");
    created = await n8n(`/workflows`, {
      method: "POST",
      body: JSON.stringify(workflow),
    });
  }

  const id = created.id || existing?.id;
  console.log(`Workflow saved. id=${id}`);

  if (!created.active) {
    console.log("Activating…");
    await n8n(`/workflows/${id}/activate`, { method: "POST" });
  }

  console.log(`\n✅ ${WORKFLOW_NAME} active on daily cron "${CRON_EXPRESSION}"`);
  console.log(`   Target: ${TARGET_URL}`);
  console.log(`   Manage: ${N8N_API_URL.replace("/api/v1", "")}/workflow/${id}`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

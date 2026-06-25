#!/usr/bin/env node
/**
 * n8n Activation Audit — Phase 0 "Auditor" employee.
 *
 * Answers: for each of the ~42 deployed workflows in the TARGETS registry:
 *   1. Is the n8n `active` flag ON?
 *   2. Is an app-side feature flag gating event delivery?
 *   3. What's the 30-day success/error/skipped count in automation_logs?
 *
 * Output: a RAG (Green/Amber/Dark) table.
 *
 *   🟢 Green  — n8n active + succeeding (success_rate ≥ 80% or scheduled ok)
 *   🟡 Amber  — n8n active but high failure rate or 0 runs for a webhook workflow
 *   ⚫ Dark   — n8n inactive OR app-side flag kills dispatch before events arrive
 *
 * Usage:
 *   node scripts/n8n-activation-audit.mjs
 *   node scripts/n8n-activation-audit.mjs --json    # machine-readable
 *
 * Requires env vars (loaded from .env.local):
 *   N8N_API_URL, N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   (NEXT_PUBLIC_SUPABASE_URL or the hardcoded prod URL below)
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

// ─── n8n connection (re-uses lib.mjs pattern, no import to keep this standalone) ───
const N8N_BASE = (process.env.N8N_API_URL ?? "https://n8n.drdeeb.tech")
  .replace(/\/api\/v1\/?$/, "")
  .replace(/\/+$/, "") + "/api/v1";
const N8N_KEY = process.env.N8N_API_KEY?.replace(/[\r\n]+/g, "").trim();

// ─── Supabase connection ───────────────────────────────────────────────────────────
// Prefer NEXT_PUBLIC_SUPABASE_URL; fall back to the known prod URL.
const SB_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xyqscjnqfeusgrhmwjts.supabase.co"
).replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/[\r\n]+/g, "").trim();

// ─── Deployed workflow registry (from scripts/n8n-harden/run.mjs TARGETS) ─────────
// [n8nWorkflowId, automationLogsSlug]
const TARGETS = [
  // Also-hardened (already in place; included in audit):
  ["1aV0FOmaNuHbVVMj", "daily-admin-digest"],
  ["dldJFeIfXwvIUqyW", "platform-health-check"],

  // Cat A — single-HTTP cron-to-app:
  ["yJfMjUEbQOwWpMZH", "retention-scorer"],
  ["oSgC94xMLDGUYu8s", "bunny-stuck-lessons"],
  ["3e1PXvnyqiY1jgHv", "cron-audit-cleanup"],
  ["XqV6KlMgCbhnziG9", "cron-email-health"],
  ["G67KJ5XZqdyd68on", "cron-reconciliation"],

  // Cat B — in-flow data-fetch chains:
  ["3jAF2OnFdTXig6zQ", "session-reminder-engine"],

  // All others:
  ["FF2Cx7UkOgQ2cn9E", "role-based-welcome"],
  ["u0yd4Fej5cS0dQdV", "cv-approval-notification"],
  ["AiGdv6k9wAGNaQ8E", "teacher-onboarding-nudges"],
  ["BG33TziMJ8iw2ONX", "learning-streak-encouragement"],
  ["Ht1p0jnJddxQrknD", "no-show-detector"],
  ["Iz8jANQ4yZ7smODw", "first-student-celebration"],
  ["JmjMRRADUGPTCf9g", "missed-session-parent-alert"],
  ["Qj4Vneu2ShJOnOom", "dailyco-room-creation"],
  ["adidbcXeBgA2840H", "abandoned-booking-recovery"],
  ["bEZEvI5xpQ6X4cHN", "package-renewal-campaign"],
  ["f0p3UNbcmsuqwPAj", "auto-decline-stale-bookings"],
  ["k8uQWfl8KwxSpBaR", "package-expiry-countdown"],
  ["mCCmTS6fcCkVhZXt", "homework-noncompletion-parent-alert"],
  ["XZuZeob3lD3Drei1", "low-package-balance-alert"],
  ["9fCxICrhtSNgFmYt", "workflow-failure-sentinel"],
  ["M22t0o9xfqkM1HDG", "milestone-celebrations"],
  ["CGxegnOS6xe7B3P1", "trial-to-paid-conversion"],
  ["BVLvCOkLh4xDq9dV", "upsell-higher-package"],
  ["48iiIRRcGU1t8nzn", "inactivity-reengagement"],
  ["jBE1MFDOImnzm8Ll", "parent-post-session-report"],
  ["DpIgSIOSwbuvAlZQ", "realtime-kpi-alerting"],
  ["3BcORNJ8cHVFhNK6", "student-at-risk-detector"],
  ["OWga3cbdhMs4oMlI", "teacher-eval-compliance"],
  ["tN8jKivAS4SwrM7J", "teacher-quality-monitor"],
  ["KX2krTAdb0S6Y2cM", "weekly-progress-digest"],
  ["WBI3NBsVCVkUBQ2L", "session-auto-complete"],
  ["cdb2iKW0dlNFWZm8", "audit-log-enrichment"],
  ["HpCTrDfCFqE0wziT", "announcement-broadcaster"],
  ["lqdQg2BvGTUpHJjF", "message-content-moderation"],

  // Spec 009 cron workflows:
  ["9HJZmdeLsaUKgZC0", "cron-auto-complete-sessions"],
  ["ezrnzox3Awy4pGMy", "cron-cache-clear"],
  ["ucQUFb31nnQY0brM", "cron-handoff-cleanup"],
  ["ddPFuoV80kGo0mkT", "cron-murajaah-due"],
  ["RvOlWJygNON7R53Q", "cron-n8n-healthcheck"],
];

// ─── Feature flags that kill app→n8n dispatch for certain event families ──────────
// Source: src/lib/automation/emit.ts EVENT_SUB_FLAGS + platform_settings keys.
// Maps: settingKey → workflows whose events are gated by it.
const FLAG_GATES = {
  automation_enabled: null, // master kill-switch; gates ALL events
  ai_parent_reports_enabled: [
    "parent-post-session-report",
    "missed-session-parent-alert",
    "homework-noncompletion-parent-alert",
  ],
  retention_automation_enabled: [
    "student-at-risk-detector",
    "retention-scorer",
    "inactivity-reengagement",
  ],
  teacher_quality_monitor_enabled: [
    "teacher-quality-monitor",
    "teacher-eval-compliance",
  ],
  renewal_campaigns_enabled: [
    "package-renewal-campaign",
    "trial-to-paid-conversion",
    "upsell-higher-package",
    "abandoned-booking-recovery",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────────
async function n8nGet(path) {
  if (!N8N_KEY) return null;
  try {
    const res = await fetch(`${N8N_BASE}${path}`, {
      headers: { "X-N8N-API-KEY": N8N_KEY, Accept: "application/json" },
    });
    if (!res.ok) {
      process.stderr.write(`[n8n] ${res.status} ${path}\n`);
      return null;
    }
    return res.json();
  } catch (e) {
    process.stderr.write(`[n8n] ${e.message}\n`);
    return null;
  }
}

async function sbGet(path) {
  if (!SB_KEY) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1${path}`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      process.stderr.write(`[supabase] ${res.status} ${path}\n`);
      return null;
    }
    return res.json();
  } catch (e) {
    process.stderr.write(`[supabase] ${e.message}\n`);
    return null;
  }
}

/**
 * Paginated GET that pages through ALL matching rows via the Range header.
 *
 * Why this exists: PostgREST enforces a server-side `db-max-rows` cap (commonly
 * 1000) that silently overrides a `&limit=` query param. A single un-paged fetch
 * therefore truncates once the table exceeds that cap — and without an explicit
 * `order=`, the truncated subset is non-deterministic, so sparse/low-volume
 * workflows (e.g. a daily cron with ~5 rows) can vanish entirely and read as
 * false "Dark/Amber". Caller MUST include an `order=` clause for a stable page
 * boundary. Returns the concatenation of every page.
 *
 * @param {string} path  REST path WITHOUT a `limit=` clause; MUST contain `order=`.
 * @param {number} [pageSize=1000]  rows per page (kept ≤ typical db-max-rows).
 */
async function sbGetAll(path, pageSize = 1000) {
  if (!SB_KEY) return null;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let res;
    try {
      res = await fetch(`${SB_URL}/rest/v1${path}`, {
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          Accept: "application/json",
          "Range-Unit": "items",
          Range: `${from}-${to}`,
        },
      });
    } catch (e) {
      process.stderr.write(`[supabase] ${e.message}\n`);
      return all.length ? all : null;
    }
    if (!res.ok && res.status !== 206) {
      process.stderr.write(`[supabase] ${res.status} ${path}\n`);
      return all.length ? all : null;
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break; // last (short) page
  }
  return all;
}

// ─── Main ─────────────────────────────────────────────────────────────────────────
const jsonMode = process.argv.includes("--json");

if (!N8N_KEY) process.stderr.write("[warn] N8N_API_KEY not set — n8n active-flag column will be unknown\n");
if (!SB_KEY) process.stderr.write("[warn] SUPABASE_SERVICE_ROLE_KEY not set — logs + flags columns will be unknown\n");

// 1. Fetch all live n8n workflows (one call — no per-ID requests needed)
process.stderr.write("[audit] Fetching n8n workflow list...\n");
const n8nList = await n8nGet("/workflows?limit=250");
/** @type {Map<string, boolean>} id → active */
const n8nActiveById = new Map(
  (n8nList?.data ?? []).map((w) => [w.id, w.active])
);

// 2. Fetch 30-day automation_logs counts grouped by workflow_name + status
process.stderr.write("[audit] Fetching automation_logs (30-day window)...\n");
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
// Paginated + explicitly ordered: a single capped fetch truncates past
// PostgREST's db-max-rows and (without order) drops sparse workflows → false Amber.
const logsRows = await sbGetAll(
  `/automation_logs?select=workflow_name,status&started_at=gte.${thirtyDaysAgo}&order=started_at.asc`
);

/** @type {Map<string, {success: number, error: number, skipped: number}>} */
const logsBySlug = new Map();
for (const row of logsRows ?? []) {
  const slug = row.workflow_name;
  if (!logsBySlug.has(slug)) logsBySlug.set(slug, { success: 0, error: 0, skipped: 0 });
  const counts = logsBySlug.get(slug);
  if (row.status === "succeeded") counts.success++;
  else if (row.status === "failed") counts.error++;
  else if (row.status === "skipped") counts.skipped++;
}

// 3. Fetch platform_settings feature flags
process.stderr.write("[audit] Fetching platform_settings feature flags...\n");
const flagKeys = Object.keys(FLAG_GATES).join(",");
const settingsRows = await sbGet(
  `/platform_settings?select=key,value&key=in.(${flagKeys})`
);
/** @type {Record<string, string>} */
const flags = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));

const masterFlagOn = flags["automation_enabled"] === "true";

// ─── Classify each target ─────────────────────────────────────────────────────────
const results = TARGETS.map(([id, slug]) => {
  // n8n active state
  const n8nKnown = n8nActiveById.has(id);
  const n8nActive = n8nActiveById.get(id) ?? null; // null = workflow not found in n8n

  // Feature flag analysis
  const masterOff = !masterFlagOn; // master=false → ALL events silenced
  const subFlagGates = Object.entries(FLAG_GATES)
    .filter(([key, slugList]) => key !== "automation_enabled" && slugList?.includes(slug))
    .filter(([key]) => flags[key] !== "true")
    .map(([key]) => key);

  const flagGated = masterOff || subFlagGates.length > 0;
  const flagNote = masterOff
    ? "automation_enabled=false"
    : subFlagGates.length > 0
    ? subFlagGates.join(", ") + "=false"
    : null;

  // 30-day log counts
  const counts = logsBySlug.get(slug) ?? null;
  const total30d = counts ? counts.success + counts.error + counts.skipped : null;
  const successRate = counts && total30d && total30d > 0
    ? counts.success / total30d
    : null;

  // RAG classification
  let status;
  if (!n8nActive || n8nActive === false) {
    // n8n says inactive (or workflow not found in n8n at all)
    status = "dark";
  } else if (flagGated) {
    // n8n active but app-side flag stops events ever arriving
    status = "dark";
  } else if (counts === null || total30d === 0) {
    // n8n active, no flag gate, but zero log rows — possibly a webhook-only
    // workflow that hasn't fired yet, or logs aren't flowing
    status = "amber";
  } else if (successRate !== null && successRate >= 0.8) {
    status = "green";
  } else {
    status = "amber";
  }

  return {
    id,
    slug,
    n8nFound: n8nKnown,
    n8nActive,
    flagGated,
    flagNote,
    success30d: counts?.success ?? 0,
    error30d: counts?.error ?? 0,
    skipped30d: counts?.skipped ?? 0,
    total30d: total30d ?? 0,
    successRate,
    status,
  };
});

// ─── Output ───────────────────────────────────────────────────────────────────────
if (jsonMode) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), masterFlagOn, flags, results }, null, 2));
  process.exit(0);
}

const ICON = { green: "🟢", amber: "🟡", dark: "⚫" };
const LABEL = { green: "GREEN", amber: "AMBER", dark: "DARK " };

const green = results.filter((r) => r.status === "green");
const amber = results.filter((r) => r.status === "amber");
const dark  = results.filter((r) => r.status === "dark");

console.log(`\nn8n Activation Audit — ${new Date().toISOString()}`);
console.log(`Master flag (automation_enabled): ${masterFlagOn ? "✅ ON" : "❌ OFF — ALL events silenced"}`);
if (Object.keys(flags).length > 0) {
  console.log("\nFeature flags:");
  for (const [k, v] of Object.entries(flags)) {
    console.log(`  ${v === "true" ? "✅" : "❌"} ${k} = ${v ?? "(not set)"}`);
  }
}

console.log(`\nSummary: 🟢 ${green.length} Green  🟡 ${amber.length} Amber  ⚫ ${dark.length} Dark\n`);

// Table: slug | n8n | flag | 30d ✅/❌/⏭ | status
const COL = [38, 10, 34, 20, 8];
const head = ["SLUG", "n8n", "FLAG GATE", "30d (✅/❌/⏭)", "STATUS"];
const hr = COL.map((w) => "─".repeat(w)).join("─┼─");
const row = (cells) => cells.map((c, i) => String(c).padEnd(COL[i])).join(" │ ");

console.log(row(head));
console.log(hr);

for (const r of results.sort((a, b) => {
  const order = { dark: 0, amber: 1, green: 2 };
  return order[a.status] - order[b.status];
})) {
  const n8nCol = r.n8nFound === false
    ? "⚠ NOT FOUND"
    : r.n8nActive === true
    ? "✅ active"
    : "❌ inactive";
  const flagCol = r.flagNote ?? "none";
  const countCol = `${r.success30d} / ${r.error30d} / ${r.skipped30d}`;
  const statusCol = `${ICON[r.status]} ${LABEL[r.status]}`;
  console.log(row([r.slug, n8nCol, flagCol, countCol, statusCol]));
}

console.log("\n");

if (dark.length > 0) {
  console.log("⚫ DARK — employees hired but not clocking in:");
  for (const r of dark) {
    const reason = !r.n8nFound
      ? "not found in n8n (was it deleted?)"
      : !r.n8nActive
      ? "n8n workflow is inactive — toggle it on in the n8n UI"
      : `flag-gated: ${r.flagNote} — set to 'true' in admin → Platform Settings`;
    console.log(`  ${r.slug}: ${reason}`);
  }
  console.log();
}

if (amber.length > 0) {
  console.log("🟡 AMBER — active but needs attention:");
  for (const r of amber) {
    const reason = r.total30d === 0
      ? "active + no flags BUT zero automation_logs rows in 30 days"
      : `success rate ${r.successRate !== null ? (r.successRate * 100).toFixed(0) : "?"}% (${r.success30d}✅ / ${r.error30d}❌ / ${r.skipped30d}⏭)`;
    console.log(`  ${r.slug}: ${reason}`);
  }
  console.log();
}

console.log(`Action items:`);
console.log(`  1. Fix ⚫ DARK workers: toggle n8n active flags or enable platform_settings flags`);
console.log(`  2. Investigate 🟡 AMBER workers: check automation_logs for error details`);
console.log(`  3. Run with --json for machine-readable output: node scripts/n8n-activation-audit.mjs --json`);
console.log(`  4. Re-run after changes to verify all workers are 🟢 GREEN\n`);

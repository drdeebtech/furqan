// Wire every cron workflow to use the dead-letter producer as its error handler.
// This makes n8n call furqan-dead-letter-producer whenever any wired workflow fails,
// which inserts a retry row into automation_dead_letter for the Nurse to process.
//
// Usage:
//   node scripts/n8n-harden/wire-error-workflow.mjs             # wire all TARGETS
//   node scripts/n8n-harden/wire-error-workflow.mjs --dry-run   # show what would change
//   node scripts/n8n-harden/wire-error-workflow.mjs <id>        # single workflow
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = (process.env.N8N_API_URL || "https://n8n.drdeeb.tech").replace(/\/api\/v1\/?$/, "") + "/api/v1";
const KEY = process.env.N8N_API_KEY;
if (!KEY) throw new Error("missing N8N_API_KEY");

// The producer workflow that receives error payloads and writes to automation_dead_letter.
const PRODUCER_ID = "by7CKOLY8DQ9ktSW";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getWorkflow(id) {
  return api("GET", `/workflows/${id}`);
}

async function wireErrorWorkflow(id) {
  const wf = await getWorkflow(id);
  const currentError = wf.settings?.errorWorkflow;
  if (currentError === PRODUCER_ID) return { status: "skipped", reason: "already wired" };

  // n8n v1 REST API only supports PUT (full replacement) — PATCH is not valid.
  // Send the full workflow object back with only settings.errorWorkflow changed.
  await api("PUT", `/workflows/${id}`, {
    ...wf,
    settings: { ...wf.settings, errorWorkflow: PRODUCER_ID },
  });
  return { status: "ok", was: currentError || "none" };
}

// All cron workflows — same list as run.mjs (excludes error-trigger and webhook-trigger workflows).
const TARGETS = [
  ["yJfMjUEbQOwWpMZH", "retention-scorer"],
  ["oSgC94xMLDGUYu8s", "bunny-stuck-lessons"],
  ["3e1PXvnyqiY1jgHv", "cron-audit-cleanup"],
  ["XqV6KlMgCbhnziG9", "cron-email-health"],
  ["G67KJ5XZqdyd68on", "cron-reconciliation"],
  ["3jAF2OnFdTXig6zQ", "session-reminder-engine"],
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
  ["9HJZmdeLsaUKgZC0", "cron-auto-complete-sessions"],
  ["ezrnzox3Awy4pGMy", "cron-cache-clear"],
  ["ucQUFb31nnQY0brM", "cron-handoff-cleanup"],
  ["ddPFuoV80kGo0mkT", "cron-murajaah-due"],
  ["RvOlWJygNON7R53Q", "cron-n8n-healthcheck"],
  ["9ax9JqAmRdeVVJpB", "package-credit-granted"],
  ["OTaYRQyIsTZYtsWz", "teacher-status"],
  ["9KwDYggodBkSLrPJ", "cron-process-broadcasts"],
  ["iZg4PFpB5uJX98Qa", "weekly-teacher-performance"],
  ["LC1IbAHxkYQOzrO7", "dead-letter-nurse"],
  // Excluded: daily-admin-digest (already hardened separately), telegram-admin-bot (webhook),
  // platform-health-check, dead-letter-producer (error trigger — is the handler, not a target)
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const single = args.find((a) => !a.startsWith("--"));

const targets = single ? [[single, "unknown"]] : TARGETS;

console.log(`Wiring ${targets.length} workflow(s) → producer ${PRODUCER_ID}${dryRun ? " [DRY RUN]" : ""}`);

const results = [];
for (const [id, slug] of targets) {
  try {
    if (dryRun) {
      const wf = await getWorkflow(id);
      const current = wf.settings?.errorWorkflow;
      results.push({ id, slug, status: "dry-run", current: current || "none", would_set: PRODUCER_ID });
      process.stdout.write(".");
    } else {
      const r = await wireErrorWorkflow(id);
      results.push({ id, slug, ...r });
      process.stdout.write(r.status === "ok" ? "." : "s");
    }
  } catch (e) {
    results.push({ id, slug, status: "error", error: e.message });
    process.stdout.write("x");
  }
}
process.stdout.write("\n");

console.log("\n=== Summary ===");
const ok = results.filter((r) => r.status === "ok").length;
const skipped = results.filter((r) => r.status === "skipped").length;
const errored = results.filter((r) => r.status === "error").length;
console.log(`ok=${ok} skipped=${skipped} errored=${errored} total=${results.length}`);
console.log("\nDetails:");
for (const r of results) console.log(JSON.stringify(r));
if (errored > 0) process.exitCode = 1;

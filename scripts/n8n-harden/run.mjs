// Bulk-harden furqan n8n workflows. Adds a parallel "Log Run" node that
// writes to automation_logs on every trigger fire, plus onError +
// alwaysOutputData on every HTTP node, and re-binds known credentials.
//
// Usage:
//   node scripts/n8n-harden/run.mjs                    # all workflows
//   node scripts/n8n-harden/run.mjs <id> <slug>        # single workflow
//   node scripts/n8n-harden/run.mjs --dry-run          # show plan only
import { hardenWorkflow, getWorkflow, applyHardening } from "./lib.mjs";

// (workflowId, automation_logs slug). Slug is the workflow_name we'll write.
// Excluded: daily-admin-digest (already hardened), the two inactive
// workflows, and the test workflow we already updated this session.
const TARGETS = [
  // Already-hardened today (skip; lib idempotent guards anyway):
  // ["1aV0FOmaNuHbVVMj", "daily-admin-digest"],
  // ["dldJFeIfXwvIUqyW", "platform-health-check"],

  // Cat A — single-HTTP cron-to-app:
  ["yJfMjUEbQOwWpMZH", "retention-scorer"],
  ["oSgC94xMLDGUYu8s", "bunny-stuck-lessons"],
  ["3e1PXvnyqiY1jgHv", "cron-audit-cleanup"],
  ["XqV6KlMgCbhnziG9", "cron-email-health"],
  ["G67KJ5XZqdyd68on", "cron-reconciliation"],

  // Cat B — in-flow data-fetch chains:
  ["3jAF2OnFdTXig6zQ", "session-reminder-engine"],

  // Everything else — categorize on the fly via getWorkflow during run:
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

  // New cron workflows wired via n8n MCP (spec 009):
  ["9HJZmdeLsaUKgZC0", "cron-auto-complete-sessions"],
  ["ezrnzox3Awy4pGMy", "cron-cache-clear"],
  ["ucQUFb31nnQY0brM", "cron-handoff-cleanup"],
  ["ddPFuoV80kGo0mkT", "cron-murajaah-due"],
  ["RvOlWJygNON7R53Q", "cron-n8n-healthcheck"],

  // AI/LLM workflows (spec 028):
  ["W3p91rvz5qgye42s", "weakness-detector"],
  ["TItGouB9AVrQ64P1", "coaching-insight"],
  ["HzyVpE4NxU0zcyDg", "risk-classifier"],
  ["oA3GwRAcQcxn1tzX", "monthly-progress-ai"],
  ["qIBeDQgiEOWiMLFB", "curriculum-advisor"],
  ["XnKFXvQJM6zsHJa9", "matching-advisor"],
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const single = args.find((a) => !a.startsWith("--"));
const singleSlug = args[args.indexOf(single) + 1];

const targets = single ? [[single, singleSlug || "unknown"]] : TARGETS;

const results = [];
for (const [id, slug] of targets) {
  try {
    if (dryRun) {
      const wf = await getWorkflow(id);
      const payload = applyHardening(wf, slug);
      results.push({ id, name: wf.name, slug, dry_run: "would PUT", added_log_node: payload.nodes.some((n) => n.name === "Log Run") });
    } else {
      const r = await hardenWorkflow(id, slug);
      results.push({ slug, ...r });
    }
    process.stdout.write(".");
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

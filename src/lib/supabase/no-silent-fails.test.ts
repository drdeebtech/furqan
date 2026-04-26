/**
 * Regression guard against the Ahmed-class silent-fail bug.
 *
 * Scans every .ts/.tsx file under src/ for Supabase mutation calls
 * (insert/update/delete/upsert) and asserts each one either:
 *   1. Captures the { error } from the result, OR
 *   2. Pipes failures through .catch() (acceptable for fire-and-forget), OR
 *   3. Appears in the explicit BEST_EFFORT_ALLOWLIST below for paths that
 *      are intentionally non-blocking (audit_log inserts, automation_logs).
 *
 * If a new mutation is introduced without one of those three, this test
 * fails — pulling the silent-fail bug out of production into PR review.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../..", "..");
const SRC = join(ROOT, "src");

// Sites where silent failure is acceptable because the write is best-effort.
// To add a new entry, justify it in the comment.
const BEST_EFFORT_ALLOWLIST = new Set<string>([
  // audit_log writes are non-blocking by design — failure logged via try/catch
  // wrapper or .catch elsewhere; never user-facing.
  // automation_logs are fire-and-forget telemetry.
]);

// Hard rule: any path matching one of these table names is auto-allowlisted as
// best-effort. Failure to log them shouldn't block user-facing actions.
// Notification-channel writes are also best-effort: a failed in-app/email/parent
// report shouldn't block the upstream business action.
const BEST_EFFORT_TABLES = new Set([
  "audit_log",
  "automation_logs",
  "message_delivery_log",
  "parent_reports",
]);

const MUTATION_RE = /await\s+\w+\.from\(\s*["'`](\w+)["'`]\s*\)\.(insert|update|delete|upsert)\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "no-silent-fails.test.ts") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function findOffenders() {
  const offenders: Array<{ file: string; line: number; table: string; op: string; snippet: string }> = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      MUTATION_RE.lastIndex = 0;
      const m = MUTATION_RE.exec(lines[i]);
      if (!m) continue;
      const [, table, op] = m;
      if (BEST_EFFORT_TABLES.has(table)) continue;
      const rel = relative(ROOT, file);
      const key = `${rel}:${i + 1}`;
      if (BEST_EFFORT_ALLOWLIST.has(key)) continue;

      // Look 10 lines back + 15 forward — handles ternary/multi-line patterns
      // where the destructure is several lines above the matched await.
      const window = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 15)).join("\n");
      const isHandled =
        /\{\s*(error|data|count)\b/.test(window) ||
        /\.catch\s*\(/.test(window) ||
        /try\s*\{[\s\S]{0,500}?(insert|update|delete|upsert)/.test(
          lines.slice(Math.max(0, i - 5), i + 2).join("\n"),
        );
      if (!isHandled) {
        offenders.push({ file: rel, line: i + 1, table, op, snippet: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return offenders;
}

describe("Supabase mutations are loud, not silent", () => {
  it("every insert/update/delete/upsert either captures { error } or is in the best-effort allowlist", () => {
    const offenders = findOffenders();
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line}  ${o.op} on ${o.table}\n    ${o.snippet}`).join("\n");
      throw new Error(
        `Found ${offenders.length} silent-fail mutation(s) — every one must capture { error } or be allowlisted:\n${report}\n\n` +
          `Fix by destructuring the error: const { error } = await supabase.from(...).insert(...);\n` +
          `Then handle the error (return { error }, log, throw, etc).\n` +
          `If the write is intentionally best-effort, add the file:line key to BEST_EFFORT_ALLOWLIST in this test file.`,
      );
    }
    expect(offenders.length).toBe(0);
  });
});

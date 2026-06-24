/**
 * Specs Index Generator — scans specs/<NNN-slug>/ folders, infers each
 * feature's lifecycle status from artefact presence + GitHub PR state,
 * and emits specs/INDEX.md.
 *
 * Per spec specs/002-specs-index-generator/. Implementation of FR-001
 * through FR-010. Idempotent: 2x run with no state change -> no diff.
 *
 * Run via: `npx tsx scripts/generate-specs-index.ts` (or `npm run specs:index`).
 * Triggered by husky pre-commit (when specs/**\/*.md is staged) and by
 * an n8n nightly cron at 03:00 UTC on the Mac mini per CLAUDE.md cron policy.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types — mirror specs/002-specs-index-generator/data-model.md exactly.
// ---------------------------------------------------------------------------

export type Status =
  | "Draft"
  | "Clarified"
  | "Planned"
  | "Tasks-ready"
  | "Implementing"
  | "Shipped"
  | "Abandoned"
  | "Malformed";

export type PRState = {
  number: number | null;
  state: "open" | "merged" | "closed-unmerged" | "none";
  url: string | null;
  closedAt: string | null;
};

export type SpecFolderScan = {
  dirName: string;
  nnnPrefix: string | null;
  slug: string | null;
  branchName: string | null;
  artefacts: {
    spec: boolean;
    plan: boolean;
    research: boolean;
    dataModel: boolean;
    quickstart: boolean;
    contracts: boolean;
    tasks: boolean;
  };
  hasClarifications: boolean;
  prState: PRState;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIR_REGEX = /^(\d{3})-([a-z][a-z0-9-]*)$/;
const ABANDONED_WINDOW_DAYS = 90;

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function dirExistsNonEmpty(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function readFileSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function extractBranchName(specMd: string | null): string | null {
  if (!specMd) return null;
  const m = specMd.match(/\*\*Feature Branch:?\*\*:?\s*`([^`]+)`/);
  return m ? m[1] : null;
}

function hasClarificationsSection(specMd: string | null): boolean {
  if (!specMd) return false;
  const idx = specMd.indexOf("## Clarifications");
  if (idx === -1) return false;
  const after = specMd.slice(idx + "## Clarifications".length);
  const nextHeading = after.search(/\n##\s/);
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
  return /^- Q:/m.test(section);
}

// ---------------------------------------------------------------------------
// PR-state lookup (cached)
// ---------------------------------------------------------------------------

export type GHPullRequest = {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
  closedAt: string | null;
};

function ghLookupRaw(branch: string): GHPullRequest | null {
  try {
    // execFile with array args (no shell) — `branch` can never be interpreted
    // as a shell command, even if it contains metacharacters.
    const out = execFileSync(
      "gh",
      [
        "pr", "list",
        "--head", branch,
        "--state", "all",
        "--json", "state,url,number,closedAt",
        "--limit", "1",
      ],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    const arr = JSON.parse(out) as GHPullRequest[];
    return arr.length > 0 ? arr[0] : null;
  } catch (err) {
    process.stderr.write(`[warn] gh pr list failed for branch=${branch}: ${(err as Error).message.split("\n")[0]}\n`);
    return null;
  }
}

function mapGHState(gh: GHPullRequest | null): PRState {
  if (!gh) return { number: null, state: "none", url: null, closedAt: null };
  let state: PRState["state"];
  if (gh.state === "OPEN") state = "open";
  else if (gh.state === "MERGED") state = "merged";
  else state = "closed-unmerged";
  return { number: gh.number, state, url: gh.url, closedAt: gh.closedAt };
}

export type GHLookup = (branch: string) => GHPullRequest | null;

async function getPRState(branch: string | null, cache: Map<string, PRState>, lookup: GHLookup): Promise<PRState> {
  if (!branch) return { number: null, state: "none", url: null, closedAt: null };
  const cached = cache.get(branch);
  if (cached) return cached;
  const fresh = mapGHState(lookup(branch));
  cache.set(branch, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Folder scan
// ---------------------------------------------------------------------------

async function scanFolder(specsDir: string, dirName: string, lookup: GHLookup, cache: Map<string, PRState>): Promise<SpecFolderScan> {
  const folder = path.join(specsDir, dirName);
  const m = dirName.match(DIR_REGEX);
  const nnnPrefix = m ? m[1] : null;
  const slug = m ? m[2] : null;

  const [
    specExists,
    planExists,
    researchExists,
    dataModelExists,
    quickstartExists,
    tasksExists,
    contractsExists,
  ] = await Promise.all([
    fileExists(path.join(folder, "spec.md")),
    fileExists(path.join(folder, "plan.md")),
    fileExists(path.join(folder, "research.md")),
    fileExists(path.join(folder, "data-model.md")),
    fileExists(path.join(folder, "quickstart.md")),
    fileExists(path.join(folder, "tasks.md")),
    dirExistsNonEmpty(path.join(folder, "contracts")),
  ]);

  const specMd = specExists ? await readFileSafe(path.join(folder, "spec.md")) : null;
  const branchName = extractBranchName(specMd);
  const hasClarifications = hasClarificationsSection(specMd);
  const prState = await getPRState(branchName, cache, lookup);

  return {
    dirName,
    nnnPrefix,
    slug,
    branchName,
    artefacts: {
      spec: specExists,
      plan: planExists,
      research: researchExists,
      dataModel: dataModelExists,
      quickstart: quickstartExists,
      contracts: contractsExists,
      tasks: tasksExists,
    },
    hasClarifications,
    prState,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle status inference (FR-003)
// ---------------------------------------------------------------------------

export function inferStatus(scan: SpecFolderScan): Status {
  if (!scan.artefacts.spec) return "Malformed";
  if (scan.prState.state === "merged") return "Shipped";
  if (scan.prState.state === "open") return "Implementing";
  if (scan.prState.state === "closed-unmerged") return "Abandoned";
  if (scan.artefacts.tasks) return "Tasks-ready";
  if (scan.artefacts.plan) return "Planned";
  if (scan.hasClarifications) return "Clarified";
  return "Draft";
}

// ---------------------------------------------------------------------------
// INDEX.md formatter
// ---------------------------------------------------------------------------

function isAbandonedRecent(scan: SpecFolderScan, now: Date): boolean {
  if (scan.prState.state !== "closed-unmerged") return false;
  if (!scan.prState.closedAt) return false;
  const closedAt = new Date(scan.prState.closedAt);
  const ageMs = now.getTime() - closedAt.getTime();
  return ageMs <= ABANDONED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function renderRow(scan: SpecFolderScan, status: Status): string {
  const link = `[${scan.dirName}](./${scan.dirName}/spec.md)`;
  const branch = scan.branchName ? `\`${scan.branchName}\`` : "_(unknown)_";
  let pr: string;
  if (scan.prState.number != null && scan.prState.url) {
    pr = `[#${scan.prState.number}](${scan.prState.url})`;
  } else {
    pr = "_(pending)_";
  }
  return `| ${link} | ${status} | ${branch} | ${pr} |`;
}

export function renderIndex(scans: SpecFolderScan[], now: Date = new Date()): string {
  const decorated = scans.map((s) => ({
    scan: s,
    status: inferStatus(s),
    abandonedRecent: isAbandonedRecent(s, now),
  }));

  const active = decorated
    .filter((d) => !(d.status === "Abandoned"))
    .sort((a, b) => {
      const an = a.scan.nnnPrefix ?? "999";
      const bn = b.scan.nnnPrefix ?? "999";
      return an.localeCompare(bn);
    });

  const abandonedRecent = decorated
    .filter((d) => d.status === "Abandoned" && d.abandonedRecent)
    .sort((a, b) => {
      const aClosed = a.scan.prState.closedAt ?? "";
      const bClosed = b.scan.prState.closedAt ?? "";
      return bClosed.localeCompare(aClosed);
    });

  const lines: string[] = [];
  lines.push("# FURQAN Specs Index");
  lines.push("");
  lines.push("> Auto-generated by `scripts/generate-specs-index.ts`.");
  lines.push("> Regenerated by husky pre-commit (on `specs/**/*.md` changes) and by an n8n nightly cron (03:00 UTC).");
  lines.push("> **Do not edit by hand** — your changes will be overwritten on the next regen.");
  lines.push("");
  lines.push("## Active specs");
  lines.push("");
  if (active.length === 0) {
    lines.push("_No specs yet._");
  } else {
    lines.push("| # | Status | Branch | PR |");
    lines.push("|---|--------|--------|----|");
    for (const d of active) {
      lines.push(renderRow(d.scan, d.status));
    }
  }
  lines.push("");
  lines.push(`## Abandoned (last ${ABANDONED_WINDOW_DAYS} days)`);
  lines.push("");
  if (abandonedRecent.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| # | Status | Branch | PR |");
    lines.push("|---|--------|--------|----|");
    for (const d of abandonedRecent) {
      lines.push(renderRow(d.scan, "Abandoned"));
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("*Run `npm run specs:index` locally to regenerate.*");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

async function writeIndexAtomic(indexPath: string, content: string): Promise<{ changed: boolean }> {
  const existing = await readFileSafe(indexPath);
  if (existing === content) {
    return { changed: false };
  }
  const tmp = `${indexPath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, indexPath);
  return { changed: true };
}

// ---------------------------------------------------------------------------
// Public entry point — also testable
// ---------------------------------------------------------------------------

export type RunOptions = {
  repoRoot?: string;
  ghLookup?: GHLookup;
  now?: Date;
};

export type RunResult = {
  activeCount: number;
  abandonedRecentCount: number;
  changed: boolean;
  warnings: string[];
};

export async function generateSpecsIndex(opts: RunOptions = {}): Promise<RunResult> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const lookup = opts.ghLookup ?? ghLookupRaw;
  const now = opts.now ?? new Date();
  const specsDir = path.join(repoRoot, "specs");
  const indexPath = path.join(specsDir, "INDEX.md");

  const warnings: string[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(specsDir);
  } catch {
    const empty = renderIndex([], now);
    const result = await writeIndexAtomic(indexPath, empty);
    return { activeCount: 0, abandonedRecentCount: 0, changed: result.changed, warnings };
  }

  const folderNames = entries.filter((n) => DIR_REGEX.test(n)).sort();

  const cache = new Map<string, PRState>();
  const scans: SpecFolderScan[] = [];
  for (const dirName of folderNames) {
    const scan = await scanFolder(specsDir, dirName, lookup, cache);
    if (!scan.artefacts.spec) {
      const w = `Malformed folder (missing spec.md): ${dirName}`;
      warnings.push(w);
      process.stderr.write(`[warn] ${w}\n`);
    }
    if (scan.artefacts.spec && !scan.branchName) {
      const w = `Missing **Feature Branch** line in ${dirName}/spec.md`;
      warnings.push(w);
      process.stderr.write(`[warn] ${w}\n`);
    }
    scans.push(scan);
  }

  const content = renderIndex(scans, now);
  const result = await writeIndexAtomic(indexPath, content);

  const decorated = scans.map((s) => ({
    status: inferStatus(s),
    abandonedRecent: isAbandonedRecent(s, now),
  }));
  const abandonedRecentCount = decorated.filter((d) => d.status === "Abandoned" && d.abandonedRecent).length;
  const activeCount = scans.length - decorated.filter((d) => d.status === "Abandoned" && !d.abandonedRecent).length - abandonedRecentCount;

  return { activeCount, abandonedRecentCount, changed: result.changed, warnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function cli(): Promise<number> {
  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf("--repo-root");
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : undefined;

  try {
    const result = await generateSpecsIndex({ repoRoot });
    if (result.changed) {
      process.stdout.write(`Wrote specs/INDEX.md (${result.activeCount} active, ${result.abandonedRecentCount} abandoned-recent)\n`);
    } else {
      process.stdout.write(`specs/INDEX.md unchanged\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`[error] generate-specs-index failed: ${(err as Error).message}\n`);
    return 2;
  }
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return argv1.endsWith("generate-specs-index.ts") || argv1.endsWith("generate-specs-index.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  cli().then((code) => process.exit(code));
}

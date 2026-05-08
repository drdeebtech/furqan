/**
 * Tests for scripts/generate-specs-index.ts.
 *
 * Covers the test plan from
 * specs/002-specs-index-generator/contracts/generate-specs-index.md.
 *
 * Tests use temp directories with synthetic spec folders + mocked gh
 * lookup. No real `gh` invocations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateSpecsIndex,
  inferStatus,
  renderIndex,
  type SpecFolderScan,
  type GHPullRequest,
  type GHLookup,
} from "../generate-specs-index";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "specs-index-test-"));
  await fs.mkdir(path.join(tmpRoot, "specs"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function makeFolder(name: string, files: Record<string, string>) {
  const dir = path.join(tmpRoot, "specs", name);
  await fs.mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(dir, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

const noPRLookup: GHLookup = () => null;

function emptyScan(dirName: string, branch: string): SpecFolderScan {
  const m = dirName.match(/^(\d{3})-([a-z][a-z0-9-]*)$/);
  return {
    dirName,
    nnnPrefix: m ? m[1] : null,
    slug: m ? m[2] : null,
    branchName: branch,
    artefacts: {
      spec: true,
      plan: false,
      research: false,
      dataModel: false,
      quickstart: false,
      contracts: false,
      tasks: false,
    },
    hasClarifications: false,
    prState: { number: null, state: "none", url: null, closedAt: null },
  };
}

// ---------------------------------------------------------------------------
// inferStatus precedence
// ---------------------------------------------------------------------------

describe("inferStatus", () => {
  it("returns Malformed when spec.md is missing", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.artefacts.spec = false;
    expect(inferStatus(scan)).toBe("Malformed");
  });

  it("returns Shipped when PR is merged", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.prState = { number: 1, state: "merged", url: "https://x", closedAt: "2026-05-01T00:00:00Z" };
    expect(inferStatus(scan)).toBe("Shipped");
  });

  it("returns Implementing when PR is open", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.prState = { number: 1, state: "open", url: "https://x", closedAt: null };
    scan.artefacts.tasks = true;
    expect(inferStatus(scan)).toBe("Implementing");
  });

  it("returns Abandoned when PR is closed-unmerged", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.prState = { number: 1, state: "closed-unmerged", url: "https://x", closedAt: "2026-05-01T00:00:00Z" };
    scan.artefacts.tasks = true;
    expect(inferStatus(scan)).toBe("Abandoned");
  });

  it("returns Tasks-ready when tasks.md exists and no PR", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.artefacts.tasks = true;
    expect(inferStatus(scan)).toBe("Tasks-ready");
  });

  it("returns Planned when plan.md exists, no tasks, no PR", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.artefacts.plan = true;
    expect(inferStatus(scan)).toBe("Planned");
  });

  it("returns Clarified when Clarifications section present, no plan/tasks/PR", () => {
    const scan = emptyScan("001-x", "001-x");
    scan.hasClarifications = true;
    expect(inferStatus(scan)).toBe("Clarified");
  });

  it("returns Draft as default", () => {
    const scan = emptyScan("001-x", "001-x");
    expect(inferStatus(scan)).toBe("Draft");
  });
});

// ---------------------------------------------------------------------------
// generateSpecsIndex end-to-end
// ---------------------------------------------------------------------------

describe("generateSpecsIndex (end-to-end)", () => {
  it("test 1 — empty specs/ produces 'No specs yet'", async () => {
    const result = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    expect(result.changed).toBe(true);
    expect(result.activeCount).toBe(0);
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("_No specs yet._");
    expect(content).toContain("# FURQAN Specs Index");
  });

  it("test 2 — folder with only spec.md → status Draft", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
    });
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| [001-foo](./001-foo/spec.md) | Draft | `001-foo` | _(pending)_ |");
  });

  it("test 3 — spec.md with Clarifications Q→A → status Clarified", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n\n## Clarifications\n\n- Q: question? → A: answer.\n",
    });
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| Clarified | `001-foo`");
  });

  it("test 4 — folder with plan.md → status Planned", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
      "plan.md": "# Plan\n",
    });
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| Planned | `001-foo`");
  });

  it("test 5 — folder with tasks.md, no PR → status Tasks-ready", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
      "plan.md": "# Plan\n",
      "tasks.md": "# Tasks\n",
    });
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| Tasks-ready | `001-foo`");
  });

  it("test 6 — gh PR open → status Implementing", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
    });
    const lookup: GHLookup = (b) =>
      b === "001-foo"
        ? ({ number: 42, state: "OPEN", url: "https://github.com/x/y/pull/42", closedAt: null } as GHPullRequest)
        : null;
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: lookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| Implementing | `001-foo` | [#42](https://github.com/x/y/pull/42) |");
  });

  it("test 7 — gh PR merged → status Shipped", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
    });
    const lookup: GHLookup = (b) =>
      b === "001-foo"
        ? ({ number: 50, state: "MERGED", url: "https://github.com/x/y/pull/50", closedAt: "2026-05-01T12:00:00Z" } as GHPullRequest)
        : null;
    await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: lookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("| Shipped | `001-foo` | [#50](https://github.com/x/y/pull/50) |");
  });

  it("test 8 — folder without spec.md → status Malformed + warning", async () => {
    await makeFolder("001-foo", {
      "plan.md": "# Plan\n",
    });
    const result = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    expect(result.warnings.some((w) => w.includes("Malformed"))).toBe(true);
  });

  it("test 9 — idempotency: 2× run with same fixture state produces same output bytes", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
      "plan.md": "# Plan\n",
    });
    const r1 = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup, now: new Date("2026-05-08T12:00:00Z") });
    expect(r1.changed).toBe(true);
    const content1 = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");

    const r2 = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup, now: new Date("2026-05-08T12:00:00Z") });
    expect(r2.changed).toBe(false);
    const content2 = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content2).toBe(content1);
  });

  it("test 10 — SC-003: scanner returns all matching folders, omits non-conforming", async () => {
    for (let i = 1; i <= 5; i++) {
      const num = String(i).padStart(3, "0");
      await makeFolder(`${num}-test-feature`, {
        "spec.md": `# Spec\n\n**Feature Branch**: \`${num}-test-feature\`\n`,
      });
    }
    await makeFolder("not-numbered", { "spec.md": "# x\n" });
    await makeFolder("12-too-short", { "spec.md": "# x\n" });

    const result = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: noPRLookup });
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");

    for (let i = 1; i <= 5; i++) {
      const num = String(i).padStart(3, "0");
      expect(content).toContain(`| [${num}-test-feature](./${num}-test-feature/spec.md) |`);
    }
    expect(content).not.toContain("not-numbered");
    expect(content).not.toContain("12-too-short");
    expect(result.activeCount).toBe(5);
  });

  it("Abandoned within 90 days surfaces in Abandoned section", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
    });
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const lookup: GHLookup = () =>
      ({ number: 99, state: "CLOSED", url: "https://github.com/x/y/pull/99", closedAt: recent } as GHPullRequest);
    const result = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: lookup });
    expect(result.abandonedRecentCount).toBe(1);
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("## Abandoned (last 90 days)");
    expect(content).toMatch(/\| Abandoned \| `001-foo` \| \[#99\]/);
  });

  it("Abandoned older than 90 days is suppressed", async () => {
    await makeFolder("001-foo", {
      "spec.md": "# Spec\n\n**Feature Branch**: `001-foo`\n",
    });
    const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const lookup: GHLookup = () =>
      ({ number: 99, state: "CLOSED", url: "https://github.com/x/y/pull/99", closedAt: old } as GHPullRequest);
    const result = await generateSpecsIndex({ repoRoot: tmpRoot, ghLookup: lookup });
    expect(result.abandonedRecentCount).toBe(0);
    const content = await fs.readFile(path.join(tmpRoot, "specs", "INDEX.md"), "utf8");
    expect(content).toContain("_None._");
    expect(content).not.toContain("001-foo");
  });
});

// ---------------------------------------------------------------------------
// renderIndex output deterministic
// ---------------------------------------------------------------------------

describe("renderIndex", () => {
  it("sorts active rows by NNN prefix ascending", () => {
    const scans: SpecFolderScan[] = [
      emptyScan("003-c", "003-c"),
      emptyScan("001-a", "001-a"),
      emptyScan("002-b", "002-b"),
    ];
    const out = renderIndex(scans, new Date("2026-05-08T12:00:00Z"));
    const aIdx = out.indexOf("001-a");
    const bIdx = out.indexOf("002-b");
    const cIdx = out.indexOf("003-c");
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });
});

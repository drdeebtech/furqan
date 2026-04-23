import { describe, it, expect } from "vitest";
import {
  detectDuplicates,
  detectHardcodedSecrets,
  detectBrokenNodes,
  detectMissingConnections,
  detectCredentialIssues,
  detectRecurringFailures,
  calculateHealthScore,
} from "./audit";
import type { N8nWorkflow, N8nWorkflowDetail, N8nExecution, N8nNode } from "./client";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkWf(id: string, name: string, active = true): N8nWorkflow {
  return { id, name, active, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

function mkNode(name: string, type: string, parameters: Record<string, unknown> = {}): N8nNode {
  return { id: name, name, type, parameters, position: [0, 0] };
}

function mkDetail(
  id: string,
  name: string,
  nodes: N8nNode[],
  connections: Record<string, unknown> = {},
  active = true,
): N8nWorkflowDetail {
  return {
    id,
    name,
    active,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nodes,
    connections,
  };
}

function mkExec(id: string, workflowId: string, status: N8nExecution["status"], startedAt: string): N8nExecution {
  return { id, workflowId, status, startedAt, stoppedAt: null };
}

// Valid-shape JWT string for the hardcoded-secret pattern
const FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

// ─── detectDuplicates ───────────────────────────────────────────────────────

describe("detectDuplicates", () => {
  it("returns no issues when all names are unique", () => {
    const issues = detectDuplicates([mkWf("1", "alpha"), mkWf("2", "beta")]);
    expect(issues).toHaveLength(0);
  });

  it("flags two active copies as critical", () => {
    const issues = detectDuplicates([mkWf("1", "dup"), mkWf("2", "dup")]);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].category).toBe("duplicate");
  });

  it("flags active+inactive pair as info (legitimate backup)", () => {
    const issues = detectDuplicates([mkWf("1", "dup", true), mkWf("2", "dup", false)]);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("info");
  });

  it("flags two inactive copies as warning", () => {
    const issues = detectDuplicates([mkWf("1", "dup", false), mkWf("2", "dup", false)]);
    expect(issues.every(i => i.severity === "warning")).toBe(true);
  });

  it("treats names case-insensitively with trim", () => {
    const issues = detectDuplicates([mkWf("1", "  Dup  "), mkWf("2", "dup")]);
    expect(issues).toHaveLength(2);
  });
});

// ─── detectHardcodedSecrets ─────────────────────────────────────────────────

describe("detectHardcodedSecrets", () => {
  it("detects JWT in header parameters", () => {
    const node = mkNode("http", "n8n-nodes-base.httpRequest", {
      headerParameters: { parameters: [{ name: "Authorization", value: `Bearer ${FAKE_JWT}` }] },
    });
    const issues = detectHardcodedSecrets(mkDetail("w", "wf", [node]));
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("hardcoded_secret");
    expect(issues[0].message).toContain("Authorization");
  });

  it("detects JWT inside Code node jsCode", () => {
    const node = mkNode("code", "n8n-nodes-base.code", { jsCode: `const t = "${FAKE_JWT}";` });
    const issues = detectHardcodedSecrets(mkDetail("w", "wf", [node]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Code node");
  });

  it("returns no issues for clean workflows", () => {
    const node = mkNode("clean", "n8n-nodes-base.code", { jsCode: "return items;" });
    expect(detectHardcodedSecrets(mkDetail("w", "wf", [node]))).toHaveLength(0);
  });
});

// ─── detectBrokenNodes ──────────────────────────────────────────────────────

describe("detectBrokenNodes", () => {
  it("flags fetch() usage in Code nodes as critical", () => {
    const node = mkNode("c", "n8n-nodes-base.code", { jsCode: "const r = await fetch('http://x');" });
    const issues = detectBrokenNodes(mkDetail("w", "wf", [node]));
    expect(issues.some(i => i.message.includes("fetch"))).toBe(true);
    expect(issues[0].severity).toBe("critical");
  });

  it("flags eval() and Function constructor", () => {
    const node = mkNode("c", "n8n-nodes-base.code", { jsCode: "eval('1'); new Function('x')();" });
    const issues = detectBrokenNodes(mkDetail("w", "wf", [node]));
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores non-Code nodes even if jsCode-like parameter appears", () => {
    const node = mkNode("h", "n8n-nodes-base.httpRequest", { jsCode: "fetch('x')" });
    expect(detectBrokenNodes(mkDetail("w", "wf", [node]))).toHaveLength(0);
  });

  it("returns no issues for safe code", () => {
    const node = mkNode("c", "n8n-nodes-base.code", { jsCode: "return items.map(i => i.json);" });
    expect(detectBrokenNodes(mkDetail("w", "wf", [node]))).toHaveLength(0);
  });
});

// ─── detectMissingConnections ───────────────────────────────────────────────

describe("detectMissingConnections", () => {
  it("flags an orphan non-trigger node", () => {
    const trigger = mkNode("Start", "n8n-nodes-base.manualTrigger");
    const orphan = mkNode("Orphan", "n8n-nodes-base.set");
    const issues = detectMissingConnections(mkDetail("w", "wf", [trigger, orphan], {}));
    expect(issues).toHaveLength(1);
    expect(issues[0].node).toBe("Orphan");
  });

  it("does not flag connected nodes", () => {
    const trigger = mkNode("Start", "n8n-nodes-base.manualTrigger");
    const target = mkNode("Next", "n8n-nodes-base.set");
    const connections = { Start: { main: [[{ node: "Next" }]] } };
    expect(detectMissingConnections(mkDetail("w", "wf", [trigger, target], connections))).toHaveLength(0);
  });

  it("skips trigger/webhook/stickyNote node types", () => {
    const nodes = [
      mkNode("T", "n8n-nodes-base.cronTrigger"),
      mkNode("N", "n8n-nodes-base.stickyNote"),
      mkNode("W", "n8n-nodes-base.webhook"),
    ];
    expect(detectMissingConnections(mkDetail("w", "wf", nodes, {}))).toHaveLength(0);
  });
});

// ─── detectCredentialIssues ─────────────────────────────────────────────────

describe("detectCredentialIssues", () => {
  it("flags known-host HTTP nodes without predefined credentials", () => {
    const node = mkNode("h", "n8n-nodes-base.httpRequest", {
      url: "https://api.telegram.org/bot123/sendMessage",
      authentication: "none",
    });
    const issues = detectCredentialIssues(mkDetail("w", "wf", [node]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Telegram");
  });

  it("flags predefinedCredentialType with no credentials configured", () => {
    const node = mkNode("h", "n8n-nodes-base.httpRequest", {
      url: "https://api.resend.com/emails",
      authentication: "predefinedCredentialType",
    });
    const issues = detectCredentialIssues(mkDetail("w", "wf", [node]));
    expect(issues.some(i => i.message.includes("no credentials configured"))).toBe(true);
  });

  it("does not flag non-httpRequest nodes", () => {
    const node = mkNode("c", "n8n-nodes-base.code", { url: "https://api.telegram.org/x" });
    expect(detectCredentialIssues(mkDetail("w", "wf", [node]))).toHaveLength(0);
  });

  it("does not flag unknown hosts", () => {
    const node = mkNode("h", "n8n-nodes-base.httpRequest", {
      url: "https://example.com/api",
      authentication: "none",
    });
    expect(detectCredentialIssues(mkDetail("w", "wf", [node]))).toHaveLength(0);
  });
});

// ─── detectRecurringFailures ────────────────────────────────────────────────

describe("detectRecurringFailures", () => {
  const recent = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

  it("flags 3+ errors in last hour", () => {
    const execs = [
      mkExec("1", "wfA", "error", recent()),
      mkExec("2", "wfA", "error", recent()),
      mkExec("3", "wfA", "error", recent()),
    ];
    const issues = detectRecurringFailures(execs);
    expect(issues).toHaveLength(1);
    expect(issues[0].workflowId).toBe("wfA");
  });

  it("does not flag fewer than 3 errors", () => {
    const execs = [mkExec("1", "wfA", "error", recent()), mkExec("2", "wfA", "error", recent())];
    expect(detectRecurringFailures(execs)).toHaveLength(0);
  });

  it("downgrades to warning when success rate > 90%", () => {
    const successes = Array.from({ length: 100 }, (_, i) => mkExec(`s${i}`, "wfA", "success", recent()));
    const errors = Array.from({ length: 3 }, (_, i) => mkExec(`e${i}`, "wfA", "error", recent()));
    const issues = detectRecurringFailures([...successes, ...errors]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("ignores errors older than one hour", () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const execs = [
      mkExec("1", "wfA", "error", old),
      mkExec("2", "wfA", "error", old),
      mkExec("3", "wfA", "error", old),
    ];
    expect(detectRecurringFailures(execs)).toHaveLength(0);
  });
});

// ─── calculateHealthScore ───────────────────────────────────────────────────

describe("calculateHealthScore", () => {
  it("returns 100 for no issues and perfect success rate", () => {
    expect(calculateHealthScore([], 1)).toBe(100);
  });

  it("deducts for a critical broken_node issue", () => {
    const score = calculateHealthScore(
      [{ workflowId: "w", workflowName: "w", category: "broken_node", severity: "critical", message: "" }],
      1,
    );
    expect(score).toBe(75); // 100 - 25*1.0
  });

  it("applies warning multiplier (0.6)", () => {
    const score = calculateHealthScore(
      [{ workflowId: "w", workflowName: "w", category: "hardcoded_secret", severity: "warning", message: "" }],
      1,
    );
    expect(score).toBe(85); // 100 - 25*0.6 = 85
  });

  it("deducts 20 for very low success rate (<50%)", () => {
    expect(calculateHealthScore([], 0.3)).toBe(80);
  });

  it("deducts 10 for moderate success rate (<80%)", () => {
    expect(calculateHealthScore([], 0.7)).toBe(90);
  });

  it("clamps to 0 minimum", () => {
    const manyIssues = Array.from({ length: 20 }, () => ({
      workflowId: "w",
      workflowName: "w",
      category: "broken_node" as const,
      severity: "critical" as const,
      message: "",
    }));
    expect(calculateHealthScore(manyIssues, 0)).toBe(0);
  });
});

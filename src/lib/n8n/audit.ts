/**
 * n8n Workflow Health Audit Engine.
 * Detects duplicates, hardcoded secrets, broken nodes, credential issues,
 * recurring failures, and calculates per-workflow health scores.
 */

import type { N8nWorkflow, N8nWorkflowDetail, N8nExecution, N8nNode } from "./client";

export type IssueSeverity = "critical" | "warning" | "info";

export type IssueCategory =
  | "duplicate"
  | "hardcoded_secret"
  | "broken_node"
  | "inactive_alert"
  | "missing_connection"
  | "credential_issue"
  | "recurring_failure";

export interface AuditIssue {
  workflowId: string;
  workflowName: string;
  category: IssueCategory;
  severity: IssueSeverity;
  node?: string;
  message: string;
  detail?: string;
}

export interface WorkflowHealthScore {
  workflowId: string;
  workflowName: string;
  active: boolean;
  score: number;
  issues: AuditIssue[];
  successRate: number;
  executionCount: number;
  lastExecution?: string;
}

export interface AuditReport {
  timestamp: string;
  overallScore: number;
  workflows: WorkflowHealthScore[];
  issues: AuditIssue[];
  summary: {
    totalWorkflows: number;
    activeWorkflows: number;
    duplicates: number;
    hardcodedSecrets: number;
    brokenNodes: number;
    credentialIssues: number;
    missingConnections: number;
    recurringFailures: number;
  };
}

// --- Detection Functions ---

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const SUPABASE_HOST = "xyqscjnqfeusgrhmwjts.supabase.co";
const SANDBOX_GLOBALS = ["fetch(", "require(", "import("];

function deepSearch(obj: unknown, test: (val: string) => boolean): string[] {
  const found: string[] = [];
  function walk(o: unknown) {
    if (typeof o === "string") {
      if (test(o)) found.push(o.length > 80 ? o.slice(0, 80) + "..." : o);
    } else if (Array.isArray(o)) {
      for (const item of o) walk(item);
    } else if (o && typeof o === "object") {
      for (const val of Object.values(o)) walk(val);
    }
  }
  walk(obj);
  return found;
}

export function detectDuplicates(workflows: N8nWorkflow[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const nameMap = new Map<string, N8nWorkflow[]>();
  for (const wf of workflows) {
    const list = nameMap.get(wf.name) || [];
    list.push(wf);
    nameMap.set(wf.name, list);
  }
  for (const [name, wfs] of nameMap) {
    if (wfs.length <= 1) continue;
    const activeCount = wfs.filter(w => w.active).length;
    const severity: IssueSeverity = activeCount > 1 ? "critical" : "warning";
    for (const wf of wfs) {
      issues.push({
        workflowId: wf.id,
        workflowName: wf.name,
        category: "duplicate",
        severity,
        message: `${activeCount > 1 ? "Multiple active copies" : "Duplicate name"} (${wfs.length}x)`,
        detail: `IDs: ${wfs.map(w => w.id).join(", ")}. ${activeCount} active.`,
      });
    }
  }
  return issues;
}

export function detectHardcodedSecrets(workflow: N8nWorkflowDetail): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const node of workflow.nodes) {
    // Check header parameters for JWTs
    const headers = (node.parameters as Record<string, unknown>)?.headerParameters as { parameters?: Array<{ name: string; value: string }> } | undefined;
    if (headers?.parameters) {
      for (const h of headers.parameters) {
        if (JWT_PATTERN.test(h.value || "")) {
          issues.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            category: "hardcoded_secret",
            severity: "warning",
            node: node.name,
            message: `Hardcoded JWT in header "${h.name}"`,
            detail: `Node type: ${node.type}`,
          });
        }
      }
    }
    // Check Code node jsCode for embedded secrets
    const jsCode = (node.parameters as Record<string, unknown>)?.jsCode;
    if (typeof jsCode === "string" && JWT_PATTERN.test(jsCode)) {
      issues.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        category: "hardcoded_secret",
        severity: "warning",
        node: node.name,
        message: "Hardcoded JWT in Code node",
        detail: `Found JWT pattern in jsCode`,
      });
    }
    // Deep search all parameters for Supabase-specific keys
    const supaMatches = deepSearch(node.parameters, val =>
      val.includes(SUPABASE_HOST) && JWT_PATTERN.test(val)
    );
    if (supaMatches.length > 0 && !issues.some(i => i.node === node.name && i.category === "hardcoded_secret")) {
      issues.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        category: "hardcoded_secret",
        severity: "warning",
        node: node.name,
        message: "Hardcoded Supabase key in parameters",
      });
    }
  }
  return issues;
}

export function detectBrokenNodes(workflow: N8nWorkflowDetail): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const node of workflow.nodes) {
    if (node.type !== "n8n-nodes-base.code") continue;
    const jsCode = (node.parameters as Record<string, unknown>)?.jsCode;
    if (typeof jsCode !== "string") continue;
    for (const g of SANDBOX_GLOBALS) {
      if (jsCode.includes(g)) {
        issues.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          category: "broken_node",
          severity: "critical",
          node: node.name,
          message: `Code node uses "${g.replace("(", "")}" which is unavailable in n8n sandbox`,
          detail: "Use $http.request() instead of fetch(), or restructure as HTTP Request node",
        });
      }
    }
  }
  return issues;
}

export function detectMissingConnections(workflow: N8nWorkflowDetail): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const connections = workflow.connections as Record<string, Record<string, Array<Array<{ node: string }>>>>;
  const connectedNodes = new Set<string>();
  // Collect all nodes that appear in connections (as source or target)
  for (const [sourceName, outputs] of Object.entries(connections)) {
    connectedNodes.add(sourceName);
    for (const outputType of Object.values(outputs)) {
      for (const conns of outputType) {
        for (const c of conns) {
          connectedNodes.add(c.node);
        }
      }
    }
  }
  for (const node of workflow.nodes) {
    // Skip trigger nodes (they're sources, no input needed)
    if (node.type.includes("Trigger") || node.type.includes("trigger") || node.type.includes("webhook")) continue;
    if (!connectedNodes.has(node.name)) {
      issues.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        category: "missing_connection",
        severity: "info",
        node: node.name,
        message: "Node is not connected to any other node",
        detail: `Type: ${node.type}`,
      });
    }
  }
  return issues;
}

export function detectCredentialIssues(workflow: N8nWorkflowDetail): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const node of workflow.nodes) {
    if (node.type !== "n8n-nodes-base.httpRequest") continue;
    const url = String((node.parameters as Record<string, unknown>)?.url || "");
    if (!url.includes(SUPABASE_HOST)) continue;
    const auth = (node.parameters as Record<string, unknown>)?.authentication;
    if (auth !== "predefinedCredentialType") {
      issues.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        category: "credential_issue",
        severity: "warning",
        node: node.name,
        message: "Supabase HTTP node without credential-based auth",
        detail: `Uses authentication="${auth || "none"}" instead of predefinedCredentialType`,
      });
    }
  }
  return issues;
}

export function detectRecurringFailures(executions: N8nExecution[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const byWorkflow = new Map<string, N8nExecution[]>();
  for (const ex of executions) {
    if (ex.status !== "error") continue;
    const list = byWorkflow.get(ex.workflowId) || [];
    list.push(ex);
    byWorkflow.set(ex.workflowId, list);
  }
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [wfId, execs] of byWorkflow) {
    const sorted = execs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const recentCount = sorted.filter(e => new Date(e.startedAt).getTime() > oneHourAgo).length;
    if (recentCount >= 3) {
      issues.push({
        workflowId: wfId,
        workflowName: wfId, // overwritten by caller with real name if available
        category: "recurring_failure",
        severity: "critical",
        message: `${recentCount} failures in the last hour`,
        detail: `Latest: ${sorted[0]?.startedAt ?? "unknown"}`,
      });
    }
  }
  return issues;
}

export function calculateHealthScore(
  issues: AuditIssue[],
  successRate: number,
): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 30;
    else if (issue.severity === "warning") score -= 10;
    else score -= 3;
  }
  // Deduct for low success rate
  if (successRate < 0.5) score -= 20;
  else if (successRate < 0.8) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export function runFullAudit(
  workflows: N8nWorkflowDetail[],
  executions: N8nExecution[],
): AuditReport {
  const allIssues: AuditIssue[] = [];

  // Workflow-level detections
  allIssues.push(...detectDuplicates(workflows));
  for (const wf of workflows) {
    allIssues.push(...detectHardcodedSecrets(wf));
    allIssues.push(...detectBrokenNodes(wf));
    allIssues.push(...detectMissingConnections(wf));
    allIssues.push(...detectCredentialIssues(wf));
  }

  // Execution-level detections
  const recurringIssues = detectRecurringFailures(executions);
  // Fill in workflow names for recurring failures
  const nameMap = new Map(workflows.map(w => [w.id, w.name]));
  for (const issue of recurringIssues) {
    issue.workflowName = nameMap.get(issue.workflowId) || issue.workflowId;
  }
  allIssues.push(...recurringIssues);

  // Per-workflow scores
  const execByWorkflow = new Map<string, N8nExecution[]>();
  for (const ex of executions) {
    const list = execByWorkflow.get(ex.workflowId) || [];
    list.push(ex);
    execByWorkflow.set(ex.workflowId, list);
  }

  const workflowScores: WorkflowHealthScore[] = workflows.map(wf => {
    const wfIssues = allIssues.filter(i => i.workflowId === wf.id);
    const wfExecs = execByWorkflow.get(wf.id) || [];
    const successCount = wfExecs.filter(e => e.status === "success").length;
    const successRate = wfExecs.length > 0 ? successCount / wfExecs.length : 1;
    return {
      workflowId: wf.id,
      workflowName: wf.name,
      active: wf.active,
      score: calculateHealthScore(wfIssues, successRate),
      issues: wfIssues,
      successRate,
      executionCount: wfExecs.length,
      lastExecution: wfExecs[0]?.startedAt,
    };
  });

  const overallScore = workflowScores.length > 0
    ? Math.round(workflowScores.reduce((sum, w) => sum + w.score, 0) / workflowScores.length)
    : 100;

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    workflows: workflowScores.sort((a, b) => a.score - b.score),
    issues: allIssues,
    summary: {
      totalWorkflows: workflows.length,
      activeWorkflows: workflows.filter(w => w.active).length,
      duplicates: allIssues.filter(i => i.category === "duplicate").length,
      hardcodedSecrets: allIssues.filter(i => i.category === "hardcoded_secret").length,
      brokenNodes: allIssues.filter(i => i.category === "broken_node").length,
      credentialIssues: allIssues.filter(i => i.category === "credential_issue").length,
      missingConnections: allIssues.filter(i => i.category === "missing_connection").length,
      recurringFailures: allIssues.filter(i => i.category === "recurring_failure").length,
    },
  };
}

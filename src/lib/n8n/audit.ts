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
const CREDENTIAL_HOSTS = [
  { host: "xyqscjnqfeusgrhmwjts.supabase.co", name: "Supabase" },
  { host: "api.daily.co", name: "Daily.co" },
  { host: "api.telegram.org", name: "Telegram" },
  { host: "api.resend.com", name: "Resend" },
];
const FORBIDDEN_PATTERNS = [
  { pattern: /\bfetch\s*\(/, name: "fetch()", detail: "Use $http.request() instead" },
  { pattern: /\brequire\s*\(/, name: "require()", detail: "Use built-in n8n nodes" },
  { pattern: /\bimport\s*\(/, name: "dynamic import()", detail: "Use built-in n8n nodes" },
  { pattern: /\bprocess\b/, name: "process", detail: "Not available in n8n sandbox" },
  { pattern: /\bBuffer\b/, name: "Buffer", detail: "Not available in n8n sandbox" },
  { pattern: /\beval\s*\(/, name: "eval()", detail: "Not allowed in sandbox" },
  { pattern: /new\s+Function\s*\(/, name: "Function constructor", detail: "Not allowed in sandbox" },
];

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
    const key = wf.name.toLowerCase().trim();
    const list = nameMap.get(key) || [];
    list.push(wf);
    nameMap.set(key, list);
  }
  for (const [, wfs] of nameMap) {
    if (wfs.length <= 1) continue;
    const activeCount = wfs.filter(w => w.active).length;
    const inactiveCount = wfs.length - activeCount;
    let severity: IssueSeverity;
    if (activeCount >= 2) {
      severity = "critical";
    } else if (activeCount === 1 && inactiveCount >= 1) {
      severity = "info"; // legitimate backup pattern
    } else {
      severity = "warning";
    }
    for (const wf of wfs) {
      issues.push({
        workflowId: wf.id,
        workflowName: wf.name,
        category: "duplicate",
        severity,
        message: `${activeCount >= 2 ? "Multiple active copies" : activeCount === 1 ? "Active + inactive backup copies" : "Duplicate name"} (${wfs.length}x)`,
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
    // Deep search all parameters for known-service keys
    for (const svc of CREDENTIAL_HOSTS) {
      const svcMatches = deepSearch(node.parameters, val =>
        val.includes(svc.host) && JWT_PATTERN.test(val)
      );
      if (svcMatches.length > 0 && !issues.some(i => i.node === node.name && i.category === "hardcoded_secret")) {
        issues.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          category: "hardcoded_secret",
          severity: "warning",
          node: node.name,
          message: `Hardcoded ${svc.name} key in parameters`,
        });
      }
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
    for (const fp of FORBIDDEN_PATTERNS) {
      if (fp.pattern.test(jsCode)) {
        issues.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          category: "broken_node",
          severity: "critical",
          node: node.name,
          message: `Code node uses "${fp.name}" which is unavailable in n8n sandbox`,
          detail: fp.detail,
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
  const SKIP_TYPES = /Trigger|trigger|webhook|WebHook|NoOp|noOp|StickyNote|stickyNote|cron|interval/i;
  for (const node of workflow.nodes) {
    // Skip trigger nodes and non-connectable nodes (they're sources or annotations, no input needed)
    if (SKIP_TYPES.test(node.type)) continue;
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
    const auth = (node.parameters as Record<string, unknown>)?.authentication;
    // Check URL against all known service hosts
    for (const svc of CREDENTIAL_HOSTS) {
      if (!url.includes(svc.host)) continue;
      if (auth !== "predefinedCredentialType") {
        issues.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          category: "credential_issue",
          severity: "warning",
          node: node.name,
          message: `${svc.name} HTTP node without credential-based auth`,
          detail: `Uses authentication="${auth || "none"}" instead of predefinedCredentialType`,
        });
      }
    }
    // Verify predefinedCredentialType nodes actually have credentials configured
    if (auth === "predefinedCredentialType") {
      const creds = (node as unknown as Record<string, unknown>).credentials;
      if (!creds || typeof creds !== "object" || Object.keys(creds).length === 0) {
        issues.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          category: "credential_issue",
          severity: "warning",
          node: node.name,
          message: "HTTP node uses predefinedCredentialType but has no credentials configured",
          detail: "Add a credential entry to avoid runtime authentication failures",
        });
      }
    }
  }
  return issues;
}

export function detectRecurringFailures(executions: N8nExecution[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  // Group all executions by workflow (not just errors)
  const allByWorkflow = new Map<string, N8nExecution[]>();
  for (const ex of executions) {
    const list = allByWorkflow.get(ex.workflowId) || [];
    list.push(ex);
    allByWorkflow.set(ex.workflowId, list);
  }
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [wfId, allExecs] of allByWorkflow) {
    const recentAll = allExecs.filter(e => new Date(e.startedAt).getTime() > oneHourAgo);
    const recentErrors = recentAll.filter(e => e.status === "error");
    const recentErrorCount = recentErrors.length;
    if (recentErrorCount >= 3) {
      const totalRecent = recentAll.length;
      const successRate = totalRecent > 0 ? (totalRecent - recentErrorCount) / totalRecent : 0;
      // High-volume workflow with occasional failures is less alarming
      const severity: IssueSeverity = recentErrorCount >= 3 && successRate > 0.9 ? "warning" : "critical";
      const sorted = recentErrors.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      issues.push({
        workflowId: wfId,
        workflowName: wfId, // overwritten by caller with real name if available
        category: "recurring_failure",
        severity,
        message: `${recentErrorCount} failures in the last hour (success rate: ${(successRate * 100).toFixed(0)}% of ${totalRecent} executions)`,
        detail: `Latest: ${sorted[0]?.startedAt ?? "unknown"}`,
      });
    }
  }
  return issues;
}

const CATEGORY_WEIGHTS: Record<IssueCategory, number> = {
  hardcoded_secret: 25,
  broken_node: 25,
  credential_issue: 20,
  recurring_failure: 15,
  duplicate: 12,
  inactive_alert: 8,
  missing_connection: 3,
};
const SEVERITY_MULTIPLIERS: Record<IssueSeverity, number> = { critical: 1.0, warning: 0.6, info: 0.3 };

export function calculateHealthScore(
  issues: AuditIssue[],
  successRate: number,
): number {
  let score = 100;
  for (const issue of issues) {
    score -= CATEGORY_WEIGHTS[issue.category] * SEVERITY_MULTIPLIERS[issue.severity];
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

  // Execution-level detections — filter to last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentExecutions = executions.filter(e => new Date(e.startedAt).getTime() > thirtyDaysAgo);
  const recurringIssues = detectRecurringFailures(recentExecutions);
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
    const successRate = wfExecs.length > 0 ? successCount / wfExecs.length : 0.5;
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

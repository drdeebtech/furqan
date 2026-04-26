/**
 * n8n REST API client.
 * All calls require N8N_API_URL and N8N_API_KEY env vars.
 */

const RAW_N8N_API_URL = (process.env.N8N_API_URL ?? "").replace(/\\n|\\r/g, "").trim().replace(/\/+$/, "");
const N8N_API_URL = RAW_N8N_API_URL || "https://n8n.drdeeb.tech/api/v1";
const N8N_API_KEY = process.env.N8N_API_KEY;

async function n8nFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (!N8N_API_KEY) throw new Error("N8N_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${N8N_API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "X-N8N-API-KEY": N8N_API_KEY,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`n8n API ${res.status}: ${text}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  position: [number, number];
}

export interface N8nWorkflowDetail extends N8nWorkflow {
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "running" | "waiting";
  startedAt: string;
  stoppedAt: string | null;
  data?: { resultData?: { error?: { message: string } } };
}

export interface N8nNodeRunData {
  startTime: number;
  executionTime: number;
  executionStatus?: "success" | "error";
  error?: { message: string; stack?: string };
  data?: unknown;
}

export interface N8nExecutionDetail extends N8nExecution {
  data: {
    resultData: {
      runData?: Record<string, N8nNodeRunData[]>;
      lastNodeExecuted?: string;
      error?: { message: string; stack?: string };
    };
  };
}

export async function getWorkflows(): Promise<N8nWorkflow[]> {
  const res = await n8nFetch<{ data: N8nWorkflow[] }>("/workflows?limit=100");
  return res.data;
}

export async function getExecutions(limit = 50): Promise<N8nExecution[]> {
  const res = await n8nFetch<{ data: N8nExecution[] }>(`/executions?limit=${limit}&status=error`);
  return res.data;
}

export async function activateWorkflow(id: string): Promise<void> {
  await n8nFetch(`/workflows/${id}/activate`, { method: "POST" });
}

export async function deactivateWorkflow(id: string): Promise<void> {
  await n8nFetch(`/workflows/${id}/deactivate`, { method: "POST" });
}

export async function getWorkflowDetail(id: string): Promise<N8nWorkflowDetail> {
  return n8nFetch<N8nWorkflowDetail>(`/workflows/${id}`);
}

// n8n caps `limit` at 250 per page. For larger windows, see
// fetchAllExecutionsPaginated below which follows nextCursor.
const N8N_MAX_PAGE = 250;

export async function getAllExecutions(limit = 200): Promise<{ data: N8nExecution[]; nextCursor?: string }> {
  const safeLimit = Math.min(limit, N8N_MAX_PAGE);
  return n8nFetch<{ data: N8nExecution[]; nextCursor?: string }>(`/executions?limit=${safeLimit}`);
}

export async function fetchAllExecutionsPaginated(target: number): Promise<N8nExecution[]> {
  const out: N8nExecution[] = [];
  let cursor: string | undefined;
  while (out.length < target) {
    const remaining = target - out.length;
    const pageSize = Math.min(remaining, N8N_MAX_PAGE);
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page = await n8nFetch<{ data: N8nExecution[]; nextCursor?: string }>(
      `/executions?limit=${pageSize}${cursorParam}`,
    );
    out.push(...page.data);
    if (!page.nextCursor || page.data.length === 0) break;
    cursor = page.nextCursor;
  }
  return out;
}

export async function getExecutionDetail(id: string): Promise<N8nExecutionDetail> {
  return n8nFetch<N8nExecutionDetail>(`/executions/${id}?includeData=true`);
}

export async function getWorkflowExecutions(workflowId: string, limit = 50): Promise<N8nExecution[]> {
  const res = await n8nFetch<{ data: N8nExecution[] }>(`/executions?workflowId=${workflowId}&limit=${limit}`);
  return res.data;
}

export async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  }).catch(() => {});
}

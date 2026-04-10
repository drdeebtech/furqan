/**
 * n8n REST API client.
 * All calls require N8N_API_URL and N8N_API_KEY env vars.
 */

const N8N_API_URL = process.env.N8N_API_URL || "https://n8n.drdeeb.tech/api/v1";
const N8N_API_KEY = process.env.N8N_API_KEY;

async function n8nFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (!N8N_API_KEY) throw new Error("N8N_API_KEY not configured");

  const res = await fetch(`${N8N_API_URL}${path}`, {
    ...options,
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
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "running" | "waiting";
  startedAt: string;
  stoppedAt: string | null;
  data?: { resultData?: { error?: { message: string } } };
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

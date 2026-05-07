"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBHOOK_ROUTES,
  DEFAULT_WEBHOOK_PATH,
  serializePayload,
  type EventPayload,
} from "@/lib/automation/emit";
import { signWebhookPayload } from "@/lib/security/secrets";
import { requireAdmin as requireAdminStrict, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

export interface ReplayResult {
  success?: string;
  error?: string;
}

interface AdminCheck {
  userId?: string;
  error?: string;
}

async function requireAdmin(): Promise<AdminCheck> {
  try {
    const { id } = await requireAdminStrict();
    return { userId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { error: e.message === "not authenticated" ? "غير مسجل الدخول" : "ليس لديك صلاحية" };
    }
    throw e;
  }
}

interface FailedLogRow {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
}

interface DeadLetterRow {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
}

type ReplaySource = "log" | "dead_letter";

export async function replayAutomation({
  source,
  id,
}: {
  source: ReplaySource;
  id: string;
}): Promise<ReplayResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  if (!N8N_WEBHOOK_URL) return { error: "N8N_WEBHOOK_URL غير مضبوط" };

  const admin = createAdminClient();

  let row: FailedLogRow | DeadLetterRow | null = null;
  if (source === "log") {
    const { data } = await admin
      .from("automation_logs")
      .select("id, workflow_name, event_name, entity_type, entity_id, idempotency_key, payload_json")
      .eq("id", id)
      .returns<FailedLogRow[]>()
      .single();
    row = data;
  } else {
    const { data } = await admin
      .from("automation_dead_letter")
      .select("id, workflow_name, event_name, entity_type, entity_id, idempotency_key, payload_json")
      .eq("id", id)
      .returns<DeadLetterRow[]>()
      .single();
    row = data;
  }

  if (!row) return { error: "السجل غير موجود" };
  if (!row.payload_json) return { error: "لا يوجد محتوى للإرسال" };
  if (!row.event_name) return { error: "اسم الحدث مفقود" };

  // Cast: replay reads event_name from automation_logs/dead_letter rows as
  // an untyped DB string. WEBHOOK_ROUTES is now strictly typed (FurqanEvent
  // union) for static callers; admin replay accepts unknown strings and
  // falls back to DEFAULT_WEBHOOK_PATH for any that aren't in the map.
  const path = (WEBHOOK_ROUTES as Record<string, string>)[row.event_name] ?? DEFAULT_WEBHOOK_PATH;
  const url = `${N8N_WEBHOOK_URL}${path}`;

  const replayKey = `${row.idempotency_key ?? crypto.randomUUID()}:replay:${Date.now()}`;

  // Log the replay attempt BEFORE dispatch so we never lose the trail.
  await admin.from("automation_logs").insert({
    workflow_name: row.workflow_name,
    event_name: row.event_name,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    idempotency_key: replayKey,
    status: "started",
    payload_json: row.payload_json as never,
    error_message: null,
  }).then((r) => {
    if (r.error) logError("replayAutomation: pre-dispatch log failed", r.error, { tag: "admin-automation" });
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  // Re-sign with the same HMAC contract emitEvent uses, so n8n's verifier
  // accepts replays. The stored payload_json IS the original EventPayload.
  const rawBody = serializePayload(row.payload_json as unknown as EventPayload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Furqan-Event": row.event_name,
    "X-Furqan-Replay": "true",
    "X-Furqan-Replay-Of": row.id,
    "X-Furqan-Replay-Key": replayKey,
  };
  if (N8N_WEBHOOK_SECRET) {
    const { timestamp, signature } = signWebhookPayload(rawBody, N8N_WEBHOOK_SECRET);
    headers["X-Furqan-Timestamp"] = timestamp;
    headers["X-Furqan-Signature"] = signature;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });

    if (!res.ok) {
      await admin.from("automation_logs").insert({
        workflow_name: row.workflow_name,
        event_name: row.event_name,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        idempotency_key: `${replayKey}:result`,
        status: "failed",
        payload_json: row.payload_json as never,
        error_message: `replay HTTP ${res.status}`,
        finished_at: new Date().toISOString(),
      }).then((r) => {
        if (r.error) logError("replayAutomation: HTTP-failure log insert failed", r.error, { tag: "admin-automation" });
      });
      return { error: `فشل الإرسال: HTTP ${res.status}` };
    }

    await admin.from("audit_log").insert({
      changed_by: auth.userId,
      table_name: source === "log" ? "automation_logs" : "automation_dead_letter",
      record_id: row.id,
      action: "UPDATE",
      old_data: { event_name: row.event_name, original_id: row.id },
      new_data: { replay_key: replayKey, dispatched_to: path },
      reason: "Admin replayed automation event",
    }).then((r) => {
      if (r.error) logError("replayAutomation: audit row failed", r.error, { tag: "admin-automation" });
    });

    revalidatePath("/admin/automation/replay");
    return { success: `تم إعادة الإرسال (${replayKey.slice(0, 16)}…)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل غير متوقع";
    await admin.from("automation_logs").insert({
      workflow_name: row.workflow_name,
      event_name: row.event_name,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      idempotency_key: `${replayKey}:result`,
      status: "failed",
      payload_json: row.payload_json as never,
      error_message: `replay error: ${message}`,
      finished_at: new Date().toISOString(),
    }).then((r) => {
      if (r.error) logError("replayAutomation: catch-path log insert failed", r.error, { tag: "admin-automation" });
    });
    return { error: `فشل الإرسال: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function markDeadLetterResolved({
  id,
  notes,
}: {
  id: string;
  notes: string;
}): Promise<ReplayResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { error } = await admin
    .from("automation_dead_letter")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.userId,
      resolution_notes: notes.trim() || null,
    } as never)
    .eq("id", id);

  if (error) {
    logError("admin automation-replay update failed", error, { tag: "admin-automation", severity: "warning", metadata: { id, resolvedBy: auth.userId } });
    return { error: "فشل تحديث السجل" };
  }

  await admin.from("audit_log").insert({
    changed_by: auth.userId,
    table_name: "automation_dead_letter",
    record_id: id,
    action: "UPDATE",
    old_data: { resolved_at: null },
    new_data: { resolved_at: new Date().toISOString(), notes: notes.trim() || null },
    reason: "Admin marked dead letter resolved",
  }).then((r) => {
    if (r.error) logError("markDeadLetterResolved: audit row failed", r.error, { tag: "admin-automation" });
  });

  revalidatePath("/admin/automation/replay");
  return { success: "تم تسجيل الحل" };
}

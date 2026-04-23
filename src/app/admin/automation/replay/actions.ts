"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEBHOOK_ROUTES, DEFAULT_WEBHOOK_PATH } from "@/lib/automation/emit";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export interface ReplayResult {
  success?: string;
  error?: string;
}

interface AdminCheck {
  userId?: string;
  error?: string;
}

async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };
  return { userId: user.id };
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

  const path = WEBHOOK_ROUTES[row.event_name] ?? DEFAULT_WEBHOOK_PATH;
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
    payload_json: row.payload_json,
    error_message: null,
  } as never);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Furqan-Event": row.event_name,
        "X-Furqan-Replay": "true",
        "X-Furqan-Replay-Of": row.id,
        "X-Furqan-Replay-Key": replayKey,
      },
      body: JSON.stringify(row.payload_json),
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
        payload_json: row.payload_json,
        error_message: `replay HTTP ${res.status}`,
        finished_at: new Date().toISOString(),
      } as never);
      return { error: `فشل الإرسال: HTTP ${res.status}` };
    }

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
      payload_json: row.payload_json,
      error_message: `replay error: ${message}`,
      finished_at: new Date().toISOString(),
    } as never);
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

  if (error) return { error: "فشل تحديث السجل" };

  revalidatePath("/admin/automation/replay");
  return { success: "تم تسجيل الحل" };
}

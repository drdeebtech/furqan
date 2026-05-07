"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { requireAdmin as requireAdminStrict, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

export interface ModerationResult {
  success?: string;
  error?: string;
}

interface MessageFlagRow {
  id: string;
  flagged_at: string | null;
  flagged_by: string | null;
  flag_reason: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  conversation_id: string;
  sender_id: string;
}

interface EvaluationRow {
  id: string;
  student_id: string;
  teacher_id: string;
  overall_score: number | null;
  evaluation_type: string;
}

interface AdminRecipient {
  id: string;
}

async function requireAdmin(): Promise<
  { userId: string; error?: never } | { userId?: never; error: string }
> {
  try {
    const { id } = await requireAdminStrict();
    return { userId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { error: e.message === "not authenticated" ? "غير مصرح" : "هذا الإجراء للمشرفين فقط" };
    }
    throw e;
  }
}

/* ── hideMessage ──────────────────────────────────────────────────────────── */

export async function hideMessage(
  messageId: string,
  reason: string,
): Promise<ModerationResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const trimmedReason = (reason ?? "").trim();
  if (!trimmedReason || trimmedReason.length < 3) {
    return { error: "يرجى إدخال سبب واضح للإخفاء" };
  }

  // Service-role client: hiding a message is a cross-user moderation action.
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("messages")
    .select("id, flagged_at, flagged_by, flag_reason, hidden_at, hidden_by, conversation_id, sender_id")
    .eq("id", messageId)
    .single<MessageFlagRow>();

  if (!existing) return { error: "الرسالة غير موجودة" };
  if (existing.hidden_at) return { error: "الرسالة مخفية بالفعل" };

  const now = new Date().toISOString();

  const { error: updateErr } = await admin
    .from("messages")
    .update({ hidden_at: now, hidden_by: auth.userId })
    .eq("id", messageId);

  if (updateErr) return { error: "فشل إخفاء الرسالة" };

  await admin.from("audit_log").insert({
    changed_by: auth.userId,
    table_name: "messages",
    record_id: messageId,
    action: "UPDATE",
    old_data: { hidden_at: null, hidden_by: null },
    new_data: { hidden_at: now, hidden_by: auth.userId },
    reason: `Admin hid flagged message: ${trimmedReason}`,
  });

  revalidatePath("/admin/moderation");
  return { success: "تم إخفاء الرسالة" };
}

/* ── clearMessageFlag ─────────────────────────────────────────────────────── */

export async function clearMessageFlag(messageId: string): Promise<ModerationResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("messages")
    .select("id, flagged_at, flagged_by, flag_reason, hidden_at, hidden_by, conversation_id, sender_id")
    .eq("id", messageId)
    .single<MessageFlagRow>();

  if (!existing) return { error: "الرسالة غير موجودة" };
  if (!existing.flagged_at) return { error: "لا يوجد علامة على هذه الرسالة" };

  const oldData = {
    flagged_at: existing.flagged_at,
    flagged_by: existing.flagged_by,
    flag_reason: existing.flag_reason,
  };

  const { error: updateErr } = await admin
    .from("messages")
    .update({ flagged_at: null, flagged_by: null, flag_reason: null })
    .eq("id", messageId);

  if (updateErr) return { error: "فشل إزالة العلامة" };

  await admin.from("audit_log").insert({
    changed_by: auth.userId,
    table_name: "messages",
    record_id: messageId,
    action: "UPDATE",
    old_data: oldData,
    new_data: { flagged_at: null, flagged_by: null, flag_reason: null },
    reason: "Admin cleared message flag after review",
  });

  revalidatePath("/admin/moderation");
  return { success: "تم مسح العلامة" };
}

/* ── pingAdminOnEvaluation ────────────────────────────────────────────────── */

export async function pingAdminOnEvaluation(evalId: string): Promise<ModerationResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: evalRow } = await admin
    .from("session_evaluations")
    .select("id, student_id, teacher_id, overall_score, evaluation_type")
    .eq("id", evalId)
    .single<EvaluationRow>();

  if (!evalRow) return { error: "التقييم غير موجود" };

  // Find all admin users to notify
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .returns<AdminRecipient[]>();

  const recipients = admins ?? [];
  if (recipients.length === 0) return { error: "لا يوجد مشرفون للإشعار" };

  const scoreText = evalRow.overall_score !== null
    ? evalRow.overall_score.toFixed(2)
    : "—";

  // Non-blocking multi-channel dispatch
  await Promise.all(
    recipients.map((a) =>
      notify({
        userId: a.id,
        type: "system",
        title: "تقييم منخفض يحتاج مراجعة",
        body: `تقييم بدرجة ${scoreText} يتطلب مراجعة المشرف.`,
        entityType: "session_evaluation",
        entityId: evalRow.id,
      }).catch((err) =>
        logError("notify admin failed during pingAdminOnEvaluation", err, {
          component: "admin.moderation.pingAdminOnEvaluation",
          metadata: { recipientId: a.id, evalId: evalRow.id },
        }),
      ),
    ),
  );

  // Audit log the ping action
  await admin.from("audit_log").insert({
    changed_by: auth.userId,
    table_name: "session_evaluations",
    record_id: evalId,
    action: "UPDATE",
    old_data: null,
    new_data: { admins_pinged: recipients.length, overall_score: evalRow.overall_score },
    reason: "Admin pinged admin team about low-scoring evaluation",
  });

  revalidatePath("/admin/moderation");
  return { success: `تم إشعار ${recipients.length} مشرف` };
}

/* ── dismissEvaluation ────────────────────────────────────────────────────── */

export async function dismissEvaluation(
  evalId: string,
  note: string,
): Promise<ModerationResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: evalRow } = await admin
    .from("session_evaluations")
    .select("id, student_id, teacher_id, overall_score, evaluation_type")
    .eq("id", evalId)
    .single<EvaluationRow>();

  if (!evalRow) return { error: "التقييم غير موجود" };

  const trimmedNote = (note ?? "").trim();

  await admin.from("audit_log").insert({
    changed_by: auth.userId,
    table_name: "session_evaluations",
    record_id: evalId,
    action: "UPDATE",
    old_data: null,
    new_data: { reviewed: true, overall_score: evalRow.overall_score },
    reason: trimmedNote
      ? `Moderator reviewed evaluation: ${trimmedNote}`
      : "Moderator reviewed evaluation",
  });

  revalidatePath("/admin/moderation");
  return { success: "تم تسجيل المراجعة" };
}

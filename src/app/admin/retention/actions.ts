"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminOrModerator, ForbiddenError } from "@/lib/auth/require-admin";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

export type InterventionType =
  | "re_engagement"
  | "renewal_offer"
  | "expiry_reminder"
  | "urgent_contact"
  | "weekly_followup";

const TEMPLATES: Record<InterventionType, { title: string; body: string }> = {
  re_engagement: {
    title: "اشتقنا إليك",
    body: "مر وقت منذ آخر جلسة لك. فريقنا هنا لدعمك في استكمال رحلتك مع القرآن.",
  },
  renewal_offer: {
    title: "باقتك على وشك الانتهاء",
    body: "لديك عدد محدود من الجلسات المتبقية. جدّد الآن لضمان استمرار جلساتك دون انقطاع.",
  },
  expiry_reminder: {
    title: "تذكير: باقتك تنتهي قريباً",
    body: "باقتك تنتهي خلال أيام قليلة. جدّد الآن للاستفادة من الجلسات المتبقية.",
  },
  urgent_contact: {
    title: "نود الاطمئنان عليك",
    body: "فريق الدعم سيتواصل معك قريباً. لأي استفسار يمكنك الرد على هذه الرسالة.",
  },
  weekly_followup: {
    title: "متابعة أسبوعية",
    body: "كيف تسير رحلتك؟ فريقنا هنا للإجابة على أي سؤال أو دعمك في وضع خطة جديدة.",
  },
};

export async function logIntervention(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const studentId = formData.get("student_id")?.toString();
  const type = formData.get("intervention_type")?.toString() as InterventionType | undefined;

  if (!studentId || !type || !TEMPLATES[type]) {
    return { ok: false, error: "معطيات غير صالحة" };
  }

  let actor: { id: string };
  try {
    actor = await requireAdminOrModerator();
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "غير مصرح" };
    throw e;
  }

  const supabase = await createClient();
  const tpl = TEMPLATES[type];

  try {
    await notify({
      userId: studentId,
      type: "system",
      title: tpl.title,
      body: tpl.body,
      entityType: "retention_signal",
      entityId: studentId,
      templateName: `retention_${type}`,
      urgent: type === "urgent_contact",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل الإرسال" };
  }

  const { error: stampError } = await supabase
    .from("retention_signals")
    .update({
      last_intervention_at: new Date().toISOString(),
      intervention_type: type,
    } as never)
    .eq("student_id", studentId);

  if (stampError) {
    logError("admin retention stamp failed", stampError, {
      tag: "admin-retention",
      severity: "warning",
      metadata: { studentId, interventionType: type, actorId: actor.id },
    });
    return { ok: false, error: stampError.message };
  }

  // Write to automation_logs for per-student intervention history.
  // Best-effort: don't block the user on a log failure, but pipe the
  // failure through logError so it's visible in Sentry.
  const now = new Date().toISOString();
  await supabase.from("automation_logs").insert({
    workflow_name: "retention-intervention",
    event_name: "retention.intervention_triggered",
    entity_type: "student",
    entity_id: studentId,
    status: "succeeded",
    payload_json: {
      intervention_type: type,
      triggered_by: actor.id,
      template_name: `retention_${type}`,
      title: tpl.title,
    },
    started_at: now,
    finished_at: now,
  } as never).then(({ error }) => {
    if (error) {
      logError("admin retention automation_logs insert failed", error, {
        tag: "admin-retention",
        severity: "warning",
        metadata: { studentId, interventionType: type },
      });
    }
  });

  try {
    await emitEvent(
      "retention.intervention_triggered",
      "student",
      studentId,
      { intervention_type: type, triggered_by: actor.id },
      actor.id,
    );
  } catch (err) {
    // non-blocking — but log so Sentry sees the emit failure
    logError("admin retention emitEvent failed", err, {
      tag: "admin-retention",
      severity: "warning",
      metadata: { studentId, interventionType: type },
    });
  }

  revalidatePath("/admin/retention");
  revalidatePath(`/admin/users/${studentId}`);
  return { ok: true };
}

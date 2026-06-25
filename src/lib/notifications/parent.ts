"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/logger";
import { sendSessionNarrative } from "@/lib/reports/send-narrative";

interface ParentInfo {
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

async function getParentInfo(studentId: string): Promise<ParentInfo | null> {
  // Service-role client: guardian PII is relationship-gated on `profiles` and
  // this helper runs in fire-and-forget notification paths where the acting
  // context isn't always a booking-counterparty of the student.
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("parent_name, parent_email, parent_phone")
    .eq("id", studentId)
    .single<ParentInfo>();

  if (!data || (!data.parent_email && !data.parent_phone)) return null;
  return data;
}

/**
 * Notify parent when a session is completed.
 * Routes through sendSessionNarrative which sets sent_at and emits
 * session.report_sent for the n8n parent-post-session-report workflow.
 */
export async function notifyParentSessionComplete(
  sessionId: string,
  actorId: string,
) {
  await sendSessionNarrative({ sessionId, actorId });
}

/**
 * Notify parent of a no-show.
 * Creates a parent_reports row with sent_at set; delivery is handled by
 * the n8n missed-session-parent-alert workflow via the session.no_show event.
 */
export async function notifyParentNoShow(
  studentId: string,
  teacherId: string,
  sessionDate: string,
  createdBy: string,
) {
  const parent = await getParentInfo(studentId);
  if (!parent) {
    logWarn("parent report suppressed — no parent contact on file", {
      tag: "parent-notify",
      studentId,
      reportType: "missed_session",
    });
    return;
  }

  const dateStr = new Date(sessionDate).toLocaleDateString("ar");
  const supabase = createAdminClient();
  const { error } = await supabase.from("parent_reports").insert({
    student_id: studentId,
    teacher_id: teacherId,
    report_type: "missed_session",
    title: "غياب عن جلسة",
    body: `تم تسجيل غياب ابنكم/ابنتكم عن جلسة بتاريخ ${dateStr}`,
    sent_to_email: parent.parent_email,
    sent_to_phone: parent.parent_phone,
    created_by: createdBy,
    sent_at: new Date().toISOString(),
  } as never);
  if (error) {
    logError("parent no-show report insert failed", error, {
      tag: "parent-notify",
      studentId,
      reportType: "missed_session",
    });
    throw error;
  }
}

/**
 * Notify parent when follow-up is graded as needs_work or not_done.
 * Creates a parent_reports row with sent_at set; delivery is handled by
 * the n8n homework-noncompletion-parent-alert workflow via the homework.graded event.
 */
export async function notifyParentHomeworkNotDone(
  studentId: string,
  teacherId: string,
  homeworkTitle: string,
  grade: string,
  createdBy: string,
) {
  const parent = await getParentInfo(studentId);
  if (!parent) {
    logWarn("parent report suppressed — no parent contact on file", {
      tag: "parent-notify",
      studentId,
      reportType: "custom",
    });
    return;
  }

  const gradeLabel = grade === "completed_not_done" ? "لم يُنجز" : "يحتاج تحسين";
  const supabase = createAdminClient();
  const { error } = await supabase.from("parent_reports").insert({
    student_id: studentId,
    teacher_id: teacherId,
    report_type: "custom",
    title: `متابعة ${gradeLabel}`,
    body: `تم تقييم متابعة "${homeworkTitle}" لابنكم/ابنتكم: ${gradeLabel}. تمت إعادة تكليفه بالمتابعة.`,
    sent_to_email: parent.parent_email,
    sent_to_phone: parent.parent_phone,
    created_by: createdBy,
    sent_at: new Date().toISOString(),
  } as never);
  if (error) {
    logError("parent homework report insert failed", error, {
      tag: "parent-notify",
      studentId,
      reportType: "custom",
    });
    throw error;
  }
}

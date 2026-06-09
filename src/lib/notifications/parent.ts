"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/logger";

interface ParentInfo {
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

/**
 * Fetch parent contact info for a student.
 */
async function getParentInfo(studentId: string): Promise<ParentInfo | null> {
  // Backend notification machinery: use the service-role client, not the
  // requester's RLS client. Guardian PII (parent_*) is now relationship-gated
  // on `profiles`, and this helper runs in fire-and-forget notification paths
  // (no-show detector, grading) where the acting context isn't always a
  // booking-counterparty of the student — a silent null here would suppress a
  // parent report. Service role reads it reliably; exposure is unchanged
  // because this value only ever flows into a parent_reports row, never back to
  // a user.
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
 * Create a parent report and notification.
 * This is a foundation for future email/SMS integration.
 *
 * If the student has no parent contact on file, the report is silently
 * skipped — but a warning is logged so admins can see "we tried to alert
 * a parent that doesn't exist." Without this, the absence of a parent
 * row would manifest as "I marked X as not_done but the parent never
 * heard about it" with no audit trail of why.
 */
async function createParentReport(opts: {
  studentId: string;
  teacherId: string | null;
  reportType: string;
  title: string;
  body: string;
  createdBy: string;
}) {
  const parent = await getParentInfo(opts.studentId);
  if (!parent) {
    logWarn("parent report suppressed — no parent contact on file", {
      tag: "parent-notify",
      studentId: opts.studentId,
      reportType: opts.reportType,
      title: opts.title,
    });
    return;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("parent_reports").insert({
    student_id: opts.studentId,
    teacher_id: opts.teacherId,
    report_type: opts.reportType,
    title: opts.title,
    body: opts.body,
    sent_to_email: parent.parent_email,
    sent_to_phone: parent.parent_phone,
    created_by: opts.createdBy,
    // sent_at remains null until actual email/SMS integration
  } as never);
  if (error) {
    logError("parent report insert failed", error, {
      tag: "parent-notify",
      studentId: opts.studentId,
      reportType: opts.reportType,
    });
    throw error;
  }
}

/**
 * Notify parent when a session is completed.
 */
export async function notifyParentSessionComplete(
  studentId: string,
  teacherId: string,
  sessionDate: string,
  duration: number,
  createdBy: string,
) {
  const dateStr = new Date(sessionDate).toLocaleDateString("ar");
  await createParentReport({
    studentId,
    teacherId,
    reportType: "session_summary",
    title: "تم إكمال جلسة",
    body: `أكمل ابنكم/ابنتكم جلسة بتاريخ ${dateStr} — المدة: ${duration} دقيقة`,
    createdBy,
  });
}

/**
 * Notify parent when a new evaluation is added.
 */
export async function notifyParentEvaluation(
  studentId: string,
  teacherId: string,
  evaluationType: string,
  overallScore: number | null,
  createdBy: string,
) {
  const typeMap: Record<string, string> = {
    weekly: "أسبوعي",
    biweekly: "نصف شهري",
    monthly: "شهري",
    quarterly: "ربع سنوي",
  };
  const typeName = typeMap[evaluationType] ?? evaluationType;
  const scoreText = overallScore ? ` — الدرجة الإجمالية: ${overallScore}/10` : "";

  await createParentReport({
    studentId,
    teacherId,
    reportType: "evaluation",
    title: `تقييم ${typeName} جديد`,
    body: `تم إضافة تقييم ${typeName} لابنكم/ابنتكم${scoreText}`,
    createdBy,
  });
}

/**
 * Notify parent of a no-show.
 */
export async function notifyParentNoShow(
  studentId: string,
  teacherId: string,
  sessionDate: string,
  createdBy: string,
) {
  const dateStr = new Date(sessionDate).toLocaleDateString("ar");
  await createParentReport({
    studentId,
    teacherId,
    reportType: "missed_session",
    title: "غياب عن جلسة",
    body: `تم تسجيل غياب ابنكم/ابنتكم عن جلسة بتاريخ ${dateStr}`,
    createdBy,
  });
}

/**
 * Notify parent when follow-up is graded as needs_work or not_done.
 */
export async function notifyParentHomeworkNotDone(
  studentId: string,
  teacherId: string,
  homeworkTitle: string,
  grade: string,
  createdBy: string,
) {
  const gradeLabel = grade === "completed_not_done" ? "لم يُنجز" : "يحتاج تحسين";
  await createParentReport({
    studentId,
    teacherId,
    reportType: "custom",
    title: `متابعة ${gradeLabel}`,
    body: `تم تقييم متابعة "${homeworkTitle}" لابنكم/ابنتكم: ${gradeLabel}. تمت إعادة تكليفه بالمتابعة.`,
    createdBy,
  });
}

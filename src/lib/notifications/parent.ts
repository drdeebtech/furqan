"use server";

import { createClient } from "@/lib/supabase/server";

interface ParentInfo {
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

/**
 * Fetch parent contact info for a student.
 */
async function getParentInfo(studentId: string): Promise<ParentInfo | null> {
  const supabase = await createClient();
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
  if (!parent) return;

  const supabase = await createClient();
  await supabase.from("parent_reports").insert({
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
  const dateStr = new Date(sessionDate).toLocaleDateString("ar-SA");
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
  const dateStr = new Date(sessionDate).toLocaleDateString("ar-SA");
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
 * Notify parent when homework is graded as needs_work or not_done.
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
    title: `واجب ${gradeLabel}`,
    body: `تم تقييم واجب "${homeworkTitle}" لابنكم/ابنتكم: ${gradeLabel}. تم إعادة تكليفه بالواجب.`,
    createdBy,
  });
}

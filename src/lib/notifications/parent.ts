"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/logger";
import { sendSessionNarrative } from "@/lib/reports/send-narrative";
import { sendParentReportEmail } from "@/lib/email";

interface ParentInfo {
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

async function getParentInfo(studentId: string): Promise<ParentInfo | null> {
  // Service-role client: guardian PII is relationship-gated on `profiles` and
  // this helper runs in fire-and-forget notification paths where the acting
  // context isn't always a booking-counterparty of the student.
  // admin: fire-and-forget notification path; cross-context profile reads + notification inserts (issue #523)
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("parent_name, parent_email, parent_phone")
    .eq("id", studentId)
    .single<ParentInfo>();

  if (!data || (!data.parent_email && !data.parent_phone)) return null;
  return data;
}

type ReportType = "missed_session" | "custom";

/**
 * Persist a parent_reports row and attempt actual delivery to the parent.
 *
 * `sent_at` is set ONLY on a confirmed successful email send — previously it
 * was stamped at insert time, which claimed a delivery that never happened
 * (issue #548). On failure the new `error` column records the reason and
 * `sent_at` stays NULL, so a retry / ops follow-up has the truth.
 *
 * Delivery is email-only (see sendParentReportEmail for why WhatsApp-to-parent
 * isn't supported with the current Callmebot provider). If no parent_email is
 * on file the row is still written (audit trail) with sent_at NULL and no
 * error — `sent_via` stays empty to signal "no channel available".
 *
 * `report_type` is constrained to the values the two callers use; the
 * `session_summary` path goes through sendSessionNarrative (separate flow).
 */
async function createAndDeliverParentReport(args: {
  studentId: string;
  teacherId: string;
  reportType: ReportType;
  title: string;
  body: string;
  parent: ParentInfo;
}): Promise<void> {
  // admin: fire-and-forget notification path; cross-context profile reads + notification inserts (issue #523)
  const supabase = createAdminClient();
  const { studentId, teacherId, reportType, title, body, parent } = args;

  // Insert with sent_at NULL — delivery hasn't happened yet. sent_via records
  // the channels we will attempt (email if an address is on file).
  // NOTE: parent_reports has no `created_by` column in the committed schema;
  // the acting teacher id is recorded in `teacher_id`.
  const channels: string[] = parent.parent_email ? ["email"] : [];
  const { data: report, error: insertErr } = await supabase
    .from("parent_reports")
    .insert({
      student_id: studentId,
      teacher_id: teacherId,
      report_type: reportType,
      title,
      content: body,
      parent_email: parent.parent_email,
      parent_phone: parent.parent_phone,
      sent_via: channels,
      // sent_at intentionally null until delivery succeeds.
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !report) {
    logError("parent report insert failed", insertErr, {
      tag: "parent-notify",
      studentId,
      reportType,
    });
    throw insertErr ?? new Error("parent_reports insert returned no row");
  }

  // No email channel → nothing to dispatch. Row stays as a durable record
  // with sent_at NULL (no error — there was no failed attempt).
  if (!parent.parent_email) return;

  const result = await sendParentReportEmail({
    to: parent.parent_email,
    studentName: parent.parent_name,
    subject: title,
    body,
  });

  const nowIso = new Date().toISOString();
  if (result.success) {
    const { error: updErr } = await supabase
      .from("parent_reports")
      .update({ sent_at: nowIso, error: null })
      .eq("id", report.id);
    if (updErr) {
      // The email WAS sent — a failed status update is an ops nuisance, not a
      // lost delivery. Log so the row can be reconciled.
      logError("parent report sent_at update failed (email was sent)", updErr, {
        tag: "parent-notify",
        reportId: report.id,
      });
    }
    return;
  }

  // Delivery failed — record the reason, leave sent_at NULL.
  const { error: updErr } = await supabase
    .from("parent_reports")
    .update({ error: result.error ?? "unknown send failure" })
    .eq("id", report.id);
  if (updErr) {
    logError("parent report error-column update failed", updErr, {
      tag: "parent-notify",
      reportId: report.id,
    });
  }
  logWarn("parent report email failed — recorded in error column", {
    tag: "parent-notify",
    reportId: report.id,
    studentId,
    reportType,
    sendError: result.error,
  });
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
 * Notify parent of a no-show. Writes a parent_reports row and attempts
 * email delivery to the parent (sent_at set only on a confirmed send).
 *
 * `createdBy` is accepted for call-site stability but not persisted —
 * parent_reports has no created_by column; the actor is the teacher_id.
 */
export async function notifyParentNoShow(
  studentId: string,
  teacherId: string,
  sessionDate: string,
  _createdBy: string,
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
  await createAndDeliverParentReport({
    studentId,
    teacherId,
    reportType: "missed_session",
    title: "غياب عن جلسة",
    body: `تم تسجيل غياب ابنكم/ابنتكم عن جلسة بتاريخ ${dateStr}`,
    parent,
  });
}

/**
 * Notify parent when follow-up is graded as needs_work or not_done.
 * Writes a parent_reports row and attempts email delivery to the parent.
 */
export async function notifyParentHomeworkNotDone(
  studentId: string,
  teacherId: string,
  homeworkTitle: string,
  grade: string,
  _createdBy: string,
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
  await createAndDeliverParentReport({
    studentId,
    teacherId,
    reportType: "custom",
    title: `متابعة ${gradeLabel}`,
    body: `تم تقييم متابعة "${homeworkTitle}" لابنكم/ابنتكم: ${gradeLabel}. تمت إعادة تكليفه بالمتابعة.`,
    parent,
  });
}

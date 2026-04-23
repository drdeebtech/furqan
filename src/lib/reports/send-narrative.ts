"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { buildSessionNarrative, type SessionNarrative } from "./session-narrative";

export interface SendNarrativeInput {
  sessionId: string;
  actorId: string;
  /** Optional AI-generated paragraph to use in place of the templated one */
  narrativeOverride?: string;
}

export interface SendNarrativeResult {
  ok: boolean;
  parentReportId?: string;
  generated_via?: "template" | "ai";
  already_sent?: boolean;
  error?: string;
}

function renderEmailBody(n: SessionNarrative): string {
  const lines = [n.narrative_paragraph, ""];
  if (n.teaching_points.length > 0) {
    lines.push("ما تم العمل عليه:");
    for (const p of n.teaching_points) lines.push(`• ${p}`);
    lines.push("");
  }
  if (n.homework) {
    lines.push(`الواجب: ${n.homework.title}`);
    if (n.homework.description) lines.push(n.homework.description);
    lines.push("");
  }
  lines.push(n.next_steps);
  lines.push("");
  lines.push(`مدة الجلسة: ${n.duration_min} دقيقة · النوع: ${n.session_type_ar}`);
  return lines.join("\n");
}

/**
 * Generate the session narrative and send it to the parent.
 * Writes parent_reports, dispatches via the notification pipeline,
 * emits session.report_sent event for n8n subscribers.
 */
export async function sendSessionNarrative(input: SendNarrativeInput): Promise<SendNarrativeResult> {
  const supabase = createAdminClient();

  // Idempotency: a report for this session should only be sent once across all channels
  // (admin button, n8n workflow, future Vercel Cron). automation_logs is the guard.
  const { data: priorSend } = await supabase
    .from("automation_logs")
    .select("id")
    .eq("workflow_name", "parent-session-report")
    .eq("entity_id", input.sessionId)
    .eq("status", "succeeded")
    .maybeSingle<{ id: string }>();

  if (priorSend) {
    return { ok: true, already_sent: true };
  }

  const narrative = await buildSessionNarrative(input.sessionId);
  if (!narrative) {
    return { ok: false, error: "Session not found or not completed" };
  }

  // Apply AI override if provided (Sprint 8 path)
  const final: SessionNarrative = input.narrativeOverride
    ? { ...narrative, narrative_paragraph: input.narrativeOverride, generated_via: "ai" }
    : narrative;

  // Look up student + parent contact
  const { data: session } = await supabase
    .from("sessions")
    .select("booking_id")
    .eq("id", input.sessionId)
    .single<{ booking_id: string }>();
  if (!session) return { ok: false, error: "Session not found" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single<{ student_id: string; teacher_id: string }>();
  if (!booking) return { ok: false, error: "Booking not found" };

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("parent_name, parent_email, parent_phone")
    .eq("id", booking.student_id)
    .single<{ parent_name: string | null; parent_email: string | null; parent_phone: string | null }>();

  const emailBody = renderEmailBody(final);

  // Insert parent_reports row (durable record)
  const { data: report, error: reportErr } = await supabase
    .from("parent_reports")
    .insert({
      student_id: booking.student_id,
      teacher_id: booking.teacher_id,
      report_type: "session_summary",
      title: final.subject,
      body: emailBody,
      sent_to_email: studentProfile?.parent_email ?? null,
      sent_to_phone: studentProfile?.parent_phone ?? null,
      created_by: input.actorId,
      sent_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (reportErr || !report) {
    return { ok: false, error: reportErr?.message ?? "Failed to persist report" };
  }

  // Idempotency marker — future calls for this session see priorSend and short-circuit
  const nowIso = new Date().toISOString();
  await supabase.from("automation_logs").insert({
    workflow_name: "parent-session-report",
    event_name: "session.report_sent",
    entity_type: "session",
    entity_id: input.sessionId,
    status: "succeeded",
    payload_json: {
      parent_report_id: report.id,
      generated_via: final.generated_via,
      triggered_by: input.actorId,
    },
    started_at: nowIso,
    finished_at: nowIso,
  } as never);

  // Dispatch in-app notification to the student (parent emails are handled by n8n / Resend later)
  try {
    await dispatchNotification({
      userId: booking.student_id,
      type: "system",
      title: "تم إرسال ملخص الجلسة لولي الأمر",
      body: final.narrative_paragraph,
      entityType: "session",
      entityId: input.sessionId,
      templateName: "parent_session_report",
    });
  } catch {
    // non-blocking
  }

  try {
    await emitEvent(
      "session.report_sent",
      "session",
      input.sessionId,
      {
        student_id: booking.student_id,
        teacher_id: booking.teacher_id,
        parent_report_id: report.id,
        generated_via: final.generated_via,
      },
      input.actorId,
    );
  } catch {
    // non-blocking
  }

  return { ok: true, parentReportId: report.id, generated_via: final.generated_via };
}

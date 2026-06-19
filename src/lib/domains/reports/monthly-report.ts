import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";

/**
 * Spec 023 (م٦) — monthly level-assessment report generation.
 *
 * Versioned append (CHK024, clarified 2026-06-19): a corrected event appends
 * `version = MAX(version)+1`; reads select MAX(version). Identical-content
 * re-runs short-circuit to idempotent skip.
 *
 * Canonical `automation_logs` columns (round-2 clarification):
 *   workflow_name (NOT NULL), event_name, payload_json, result_json,
 *   error_message, status, idempotency_key (UNIQUE), attempt_count.
 *
 * After successful generation, emits `monthly_report.ready` (owned by this
 * spec per round-2 Q1) so n8n can dispatch email/WhatsApp and the webhook
 * callback can insert the in-app notification.
 */

export interface MonthlyReportRow {
  id: string;
  student_id: string;
  subscription_id: string | null;
  period_year: number;
  period_month: number;
  version: number;
  level_assessment_summary: string | null;
  generated_at: string;
  created_at: string;
}

export type GenerateResult =
  | { ok: true; report: MonthlyReportRow; idempotent: false }
  | { ok: true; report: MonthlyReportRow; idempotent: true; reason: "duplicate-issuance" }
  | { ok: false; error: string };

export async function generateMonthlyReport(args: {
  studentId: string;
  year: number;
  month: number;
  summary?: string;
  subscriptionId?: string | null;
}): Promise<GenerateResult> {
  const { studentId, year, month } = args;
  if (!Number.isInteger(year) || year < 2020) return { ok: false, error: `invalid year: ${year}` };
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: `invalid month: ${month}` };
  }

  const admin = createAdminClient();
  const summary = (args.summary ?? "").trim() || null;
  const subscriptionId = args.subscriptionId ?? null;

  // Find the current latest row for (student, period).
  const { data: latest, error: latestErr } = await admin
    .from("monthly_reports")
    .select("id, version, level_assessment_summary")
    .eq("student_id", studentId)
    .eq("period_year", year)
    .eq("period_month", month)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<{ id: string; version: number; level_assessment_summary: string | null } | null>();
  if (latestErr) {
    logError("generateMonthlyReport: latest-row lookup failed", latestErr, {
      tag: "reports", student_id: studentId, year, month,
    });
    return { ok: false, error: latestErr.message };
  }

  // Identical-content short-circuit → idempotent skip.
  if (latest && (latest.level_assessment_summary ?? null) === summary) {
    const { data: full } = await admin
      .from("monthly_reports")
      .select("id, student_id, subscription_id, period_year, period_month, version, level_assessment_summary, generated_at, created_at")
      .eq("id", latest.id)
      .single()
      .returns<MonthlyReportRow>();
    if (full) return { ok: true, report: full, idempotent: true, reason: "duplicate-issuance" };
  }

  // New version append.
  const nextVersion = (latest?.version ?? 0) + 1;
  const { data: inserted, error: insertErr } = await admin
    .from("monthly_reports")
    .insert({
      student_id: studentId,
      subscription_id: subscriptionId,
      period_year: year,
      period_month: month,
      version: nextVersion,
      level_assessment_summary: summary,
    })
    .select("id, student_id, subscription_id, period_year, period_month, version, level_assessment_summary, generated_at, created_at")
    .single()
    .returns<MonthlyReportRow>();
  if (insertErr || !inserted) {
    logError("generateMonthlyReport: insert failed", insertErr ?? new Error("no row"), {
      tag: "reports", student_id: studentId, year, month, version: nextVersion,
    });
    return { ok: false, error: insertErr?.message ?? "insert failed" };
  }

  // Emit monthly_report.ready so n8n can dispatch email/WhatsApp + webhook
  // callback inserts the in-app notification (per round-2 Q1: spec 023 OWNS
  // this event). Best-effort — a dispatch failure is recorded in
  // automation_logs by emitEvent; the report itself has already landed.
  try {
    await emitEvent("monthly_report.ready", "monthly_report", inserted.id, {
      student_id: studentId,
      year,
      month,
      version: nextVersion,
    });
  } catch (e) {
    logError("generateMonthlyReport: emit monthly_report.ready failed (non-fatal)", e, {
      tag: "reports", student_id: studentId, year, month,
    });
  }

  return { ok: true, report: inserted, idempotent: false };
}

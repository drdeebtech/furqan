import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { getLevelBoundaries } from "./quran-ranges";
import { getJuzBoundary } from "@/lib/quran/juz-boundaries";

export type CertificateType =
  | "appreciation_juz"
  | "appreciation_level"
  | "course_completion";

export interface CertificateRow {
  id: string;
  student_id: string;
  certificate_type: CertificateType;
  milestone_key: string;
  cited_range_start: string | null;
  cited_range_end: string | null;
  issued_at: string;
}

export type IssueResult =
  | { ok: true; certificate: CertificateRow; idempotent: false }
  | { ok: true; certificate: CertificateRow; idempotent: true }
  | { ok: false; error: string };

const WORKFLOW_NAME = "certificate_issuance";
const EVENT_NAME = "certificate.earned";

/**
 * Idempotent certificate issuance (T015, spec 023).
 *
 * Idempotency key: `cert:{studentId}:{type}:{milestoneKey}`
 * Uses automation_logs as a distributed lock:
 *   - 'started'/'succeeded'/'skipped' → cert already issued or in-flight; return idempotent
 *   - 'failed'   → delete old row, retry (T030 spec-local retry)
 *   - no row     → acquire lock ('started'), issue, update to 'succeeded'
 *
 * Juz branch (appreciation_juz) is blocked on T014a; still issues the cert
 * with cited_range_start/end = null and logs a warning.
 */
export async function issueCertificate(
  studentId: string,
  type: CertificateType,
  milestoneKey: string,
): Promise<IssueResult> {
  const idempotencyKey = `cert:${studentId}:${type}:${milestoneKey}`;
  const admin = createAdminClient();

  // 1. Check existing automation_log row.
  const { data: existingLog, error: logQueryErr } = await admin
    .from("automation_logs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{ id: string; status: string }>();

  if (logQueryErr) {
    logError("issueCertificate: log query failed", logQueryErr, { tag: "certificate" });
    return { ok: false, error: logQueryErr.message };
  }

  if (existingLog) {
    if (
      existingLog.status === "succeeded" ||
      existingLog.status === "skipped" ||
      existingLog.status === "started"
    ) {
      const existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      if (existing) return { ok: true, certificate: existing, idempotent: true };
      // 'started' but cert not yet written — in-flight idempotent response.
      return {
        ok: true,
        certificate: {
          id: "",
          student_id: studentId,
          certificate_type: type,
          milestone_key: milestoneKey,
          cited_range_start: null,
          cited_range_end: null,
          issued_at: "",
        },
        idempotent: true,
      };
    }
    if (existingLog.status === "failed") {
      // Delete failed row so we can retry (T030 spec-local retry).
      await admin.from("automation_logs").delete().eq("id", existingLog.id);
    }
  }

  // 2. Acquire the idempotency lock ('started').
  const { error: lockErr } = await admin.from("automation_logs").insert({
    workflow_name: WORKFLOW_NAME,
    event_name: EVENT_NAME,
    idempotency_key: idempotencyKey,
    status: "started",
    entity_type: "certificate",
    entity_id: studentId,
    payload_json: { student_id: studentId, type, milestone_key: milestoneKey } as never,
  });

  if (lockErr) {
    if (lockErr.code === "23505") {
      // Race condition: another request beat us to the lock.
      const existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      if (existing) return { ok: true, certificate: existing, idempotent: true };
      return { ok: false, error: "concurrent issuance in progress" };
    }
    logError("issueCertificate: log lock insert failed", lockErr, { tag: "certificate" });
    return { ok: false, error: lockErr.message };
  }

  // Fetch the log row id for later update.
  const { data: logRow } = await admin
    .from("automation_logs")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "started")
    .maybeSingle<{ id: string }>();

  const logId = logRow?.id ?? null;

  // 3. Compute cited range (level branch only — juz branch blocked on T014a).
  let citedRangeStart: string | null = null;
  let citedRangeEnd: string | null = null;

  if (type === "appreciation_level") {
    try {
      const range = getLevelBoundaries(milestoneKey);
      citedRangeStart = range.start;
      citedRangeEnd = range.end;
    } catch (e) {
      await markFailed(admin, logId, (e as Error).message);
      logError("issueCertificate: range resolution failed", e, { tag: "certificate" });
      return { ok: false, error: (e as Error).message };
    }
  } else if (type === "appreciation_juz") {
    const juzNum = parseInt(milestoneKey, 10);
    if (!Number.isInteger(juzNum) || juzNum < 1 || juzNum > 30) {
      await markFailed(admin, logId, `invalid juz milestone_key: ${milestoneKey}`);
      return { ok: false, error: `invalid juz milestone_key: ${milestoneKey}` };
    }
    const boundary = getJuzBoundary(juzNum);
    citedRangeStart = `${boundary.startSurah}:${boundary.startAyah}`;
    citedRangeEnd   = `${boundary.endSurah}:${boundary.endAyah}`;
  }
  // course_completion: null/null is correct per spec.

  // 4. Insert the certificate (idempotent via UNIQUE constraint on student_id, certificate_type, milestone_key).
  const now = new Date().toISOString();
  const { data: cert, error: certInsertErr } = await admin
    .from("certificates")
    .insert({
      student_id: studentId,
      certificate_type: type,
      milestone_key: milestoneKey,
      cited_range_start: citedRangeStart,
      cited_range_end: citedRangeEnd,
      issued_at: now,
    })
    .select("id, student_id, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at")
    .single<CertificateRow>();

  if (certInsertErr) {
    if (certInsertErr.code === "23505") {
      const existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      if (existing) {
        await markSucceeded(admin, logId, existing.id);
        return { ok: true, certificate: existing, idempotent: true };
      }
    }
    await markFailed(admin, logId, certInsertErr.message);
    logError("issueCertificate: cert insert failed", certInsertErr, { tag: "certificate" });
    return { ok: false, error: certInsertErr.message };
  }

  if (!cert) {
    const msg = "issueCertificate: insert returned no row";
    await markFailed(admin, logId, msg);
    return { ok: false, error: msg };
  }

  // 5. Mark log succeeded.
  await markSucceeded(admin, logId, cert.id);

  // 6. Emit certificate.earned (best-effort, non-blocking).
  emitEvent("certificate.earned", "certificate", cert.id, {
    student_id: studentId,
    type,
    milestone_key: milestoneKey,
  }).catch((err) =>
    logError("issueCertificate: emit certificate.earned failed", err, { tag: "certificate" }),
  );

  return { ok: true, certificate: cert, idempotent: false };
}

async function fetchExistingCert(
  admin: ReturnType<typeof createAdminClient>,
  studentId: string,
  type: CertificateType,
  milestoneKey: string,
): Promise<CertificateRow | null> {
  const { data } = await admin
    .from("certificates")
    .select("id, student_id, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at")
    .eq("student_id", studentId)
    .eq("certificate_type", type)
    .eq("milestone_key", milestoneKey)
    .maybeSingle<CertificateRow>();
  return data ?? null;
}

async function markSucceeded(
  admin: ReturnType<typeof createAdminClient>,
  logId: string | null,
  certificateId: string,
): Promise<void> {
  if (!logId) return;
  const { error } = await admin
    .from("automation_logs")
    .update({
      status: "succeeded",
      result_json: { certificate_id: certificateId } as never,
      finished_at: new Date().toISOString(),
    })
    .eq("id", logId);
  if (error) {
    logError("issueCertificate: log update to succeeded failed (non-fatal)", error, {
      tag: "certificate",
    });
  }
}

async function markFailed(
  admin: ReturnType<typeof createAdminClient>,
  logId: string | null,
  reason: string,
): Promise<void> {
  if (!logId) return;
  await admin
    .from("automation_logs")
    .update({ status: "failed", error_message: reason, finished_at: new Date().toISOString() })
    .eq("id", logId);
}

import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { getLevelBoundaries } from "./quran-ranges";
import { getJuzBoundary } from "@/lib/quran/juz-boundaries";
import { isBunnyStorageConfigured } from "@/lib/bunny/storage";

export type CertificateType =
  | "appreciation_juz"
  | "appreciation_level"
  | "course_completion";

export interface CertificateRow {
  id: string;
  student_id: string;
  certificate_type: CertificateType;
  milestone_key: string;
  cited_range_start: string;
  cited_range_end: string;
  issued_at: string;
  public_slug: string;
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
  // admin: invoked from n8n webhook — no session; writes certificates + automation_logs (issue #523)
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
    if (existingLog.status === "started") {
      let existing: CertificateRow | null = null;
      try {
        existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      } catch (e) {
        logError("issueCertificate: existing cert lookup failed", e, { tag: "certificate" });
        return { ok: false, error: "certificate lookup failed" };
      }
      if (existing) return { ok: true, certificate: existing, idempotent: true };
      return { ok: false, error: "concurrent issuance in progress" };
    }
    if (existingLog.status === "succeeded" || existingLog.status === "skipped") {
      let existing: CertificateRow | null = null;
      try {
        existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      } catch (e) {
        logError("issueCertificate: existing cert lookup failed", e, { tag: "certificate" });
        return { ok: false, error: "certificate lookup failed" };
      }
      if (existing) return { ok: true, certificate: existing, idempotent: true };
      return { ok: false, error: "idempotency log/certificate mismatch" };
    }
    if (existingLog.status === "failed") {
      // Delete failed row so we can retry (T030 spec-local retry).
      await admin.from("automation_logs").delete().eq("id", existingLog.id);
    }
  }

  // 2. Acquire the idempotency lock ('started') and get the row id in one round-trip
  //    to avoid a race where a concurrent request transitions the row before a second SELECT.
  const { data: lockRow, error: lockErr } = await admin
    .from("automation_logs")
    .insert({
      workflow_name: WORKFLOW_NAME,
      event_name: EVENT_NAME,
      idempotency_key: idempotencyKey,
      status: "started",
      entity_type: "certificate",
      entity_id: studentId,
      payload_json: { student_id: studentId, type, milestone_key: milestoneKey } as never,
    })
    .select("id")
    .single<{ id: string }>();

  if (lockErr) {
    if (lockErr.code === "23505") {
      // Race condition: another request beat us to the lock.
      let existing: CertificateRow | null = null;
      try {
        existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      } catch (e) {
        logError("issueCertificate: existing cert lookup failed", e, { tag: "certificate" });
        return { ok: false, error: "certificate lookup failed" };
      }
      if (existing) return { ok: true, certificate: existing, idempotent: true };
      return { ok: false, error: "concurrent issuance in progress" };
    }
    logError("issueCertificate: log lock insert failed", lockErr, { tag: "certificate" });
    return { ok: false, error: lockErr.message };
  }

  const logId = lockRow?.id ?? null;

  // 3. Compute cited range. course_completion uses empty string (no specific range).
  let citedRangeStart = "";
  let citedRangeEnd = "";

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
    if (!/^\d+$/.test(milestoneKey)) {
      await markFailed(admin, logId, `invalid juz milestone_key: ${milestoneKey}`);
      return { ok: false, error: `invalid juz milestone_key: ${milestoneKey}` };
    }
    const juzNum = Number(milestoneKey);
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
    .select("id, student_id, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at, public_slug")
    .single<CertificateRow>();

  if (certInsertErr) {
    if (certInsertErr.code === "23505") {
      let existing: CertificateRow | null = null;
      try {
        existing = await fetchExistingCert(admin, studentId, type, milestoneKey);
      } catch (e) {
        logError("issueCertificate: cert unique-conflict lookup failed", e, { tag: "certificate" });
        return { ok: false, error: "certificate lookup failed" };
      }
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

  // 5.5. Pre-generate PDF (best-effort, spec 031 Decision 4).
  // Guarded by isBunnyStorageConfigured() — no-ops when Bunny is unconfigured.
  // after() flushes after the response is sent so it never blocks the issuing request.
  // Wrapped in try-catch: after() throws outside a Next.js request context (e.g. tests).
  if (isBunnyStorageConfigured()) {
    const certPublicSlug = cert.public_slug;
    const certId = cert.id;
    try {
      after(async () => {
        try {
          // ponytail: dynamic imports keep heavy chromium binary out of the issuing bundle
          const [{ getPublicCertificate }, { renderCertificatePdf }, { putStorageObject }] =
            await Promise.all([
              import("./view"),
              import("./pdf"),
              import("@/lib/bunny/storage"),
            ]);

          const publicCert = await getPublicCertificate(certPublicSlug);
          if (!publicCert) return;

          const pdfBuffer = await renderCertificatePdf(publicCert);
          const remotePath = `certificates/${certPublicSlug}.pdf`;
          const publicUrl = await putStorageObject(remotePath, pdfBuffer);

          await createAdminClient()
            .from("certificates")
            .update({ pdf_url: publicUrl, pdf_generated_at: new Date().toISOString() })
            .eq("id", certId);
        } catch (err) {
          logError("issueCertificate: PDF pre-generation failed (non-fatal)", err, {
            tag: "cert_pdf",
          });
        }
      });
    } catch {
      // after() requires a Next.js request context; skip silently when invoked outside one
    }
  }

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
  const { data, error } = await admin
    .from("certificates")
    .select("id, student_id, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at, public_slug")
    .eq("student_id", studentId)
    .eq("certificate_type", type)
    .eq("milestone_key", milestoneKey)
    .maybeSingle<CertificateRow>();
  if (error) throw error;
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

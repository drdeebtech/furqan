import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";
import type { Json, NotifType } from "@/types/database";

const LogActionSchema = z.object({
  workflow_name: z.string().min(1),
  event_name: z.string().nullish(),
  entity_type: z.string().nullish(),
  entity_id: z.string().nullish(),
  idempotency_key: z.string().nullish(),
  status: z.string().nullish(),
  channel: z.string().nullish(),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  error_message: z.string().nullish(),
});

const NotifyActionSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1),
  type: z.string().optional(),
  body: z.string().nullish(),
  entity_type: z.string().nullish(),
  entity_id: z.string().nullish(),
  template_name: z.string().nullish(),
  urgent: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const CheckIdempotencySchema = z.object({
  idempotency_key: z.string().min(1),
});

const MonthlyReportReadySchema = z.object({
  student_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  version: z.number().int().min(1).optional(),
});

const CertificateEarnedSchema = z.object({
  student_id: z.string().uuid(),
  type: z.enum(["appreciation_juz", "appreciation_level", "course_completion"]),
  milestone_key: z.string().min(1).max(100),
});

const SubscriptionPastDueSchema = z.object({
  student_id: z.string().uuid(),
  subscription_id: z.string().uuid().optional(),
  student_name: z.string().max(500).optional(),
});

const SubscriptionExpiringSchema = z.object({
  student_id: z.string().uuid(),
  subscription_id: z.string().uuid().optional(),
  period_end: z.string().optional(),
  student_name: z.string().max(500).optional(),
});

const AbsenceOutcomeSchema = z.object({
  student_id: z.string().uuid(),
  attendance_id: z.string().uuid().optional(),
  student_name: z.string().max(500).optional(),
});

/**
 * n8n callback endpoint.
 * n8n calls this to write automation logs or trigger app-side actions.
 */

// notify-action throttle: a single user can receive at most this many
// in-app notifications via the n8n callback per minute. Protects against
// a compromised or runaway workflow flooding a student/teacher with
// notifications and bloating message_delivery_log.
const NOTIFY_PER_USER_PER_MINUTE = 30;
export async function POST(request: Request) {
  try {
  // Validate shared secret with constant-time comparison (timing-attack safe)
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompareSecret(secret, process.env.N8N_WEBHOOK_SECRET)) {
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, ...data } = body;

  // admin: webhook — no user session; n8n callbacks (issue #523)
  const supabase = createAdminClient();

  switch (action) {
    case "log": {
      const logParsed = LogActionSchema.safeParse(data);
      if (!logParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: logParsed.error.flatten() },
          { status: 422 },
        );
      }
      const logData = logParsed.data;
      // Write automation log entry
      const { error } = await supabase.from("automation_logs").insert({
        workflow_name: logData.workflow_name,
        event_name: logData.event_name ?? null,
        entity_type: logData.entity_type ?? null,
        entity_id: logData.entity_id ?? null,
        idempotency_key: logData.idempotency_key ?? null,
        status: logData.status ?? "succeeded",
        channel: logData.channel ?? null,
        payload_json: (logData.payload ?? null) as Json,
        result_json: (logData.result ?? null) as Json,
        error_message: logData.error_message ?? null,
        finished_at: new Date().toISOString(),
      });
      if (error) {
        logError("n8n webhook log insert failed", error, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            workflow_name: logData.workflow_name,
            event_name: logData.event_name ?? null,
            entity_type: logData.entity_type ?? null,
            entity_id: logData.entity_id ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to log" }, { status: 500 });
      }
      return NextResponse.json({ logged: true });
    }

    case "notify": {
      // Validate the payload before any use — a malformed payload must not reach
      // the throttle query or dispatch a notification with a missing recipient/
      // title. (Replaces the earlier ad-hoc user_id/title guard; now 422 with the
      // same error shape as the other validated actions.)
      const notifyParsed = NotifyActionSchema.safeParse(data);
      if (!notifyParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: notifyParsed.error.flatten() },
          { status: 422 },
        );
      }
      const notifyData = notifyParsed.data;

      // Per-user throttle: count in-app notifications delivered in the last
      // 60 seconds via this callback. If above the cap, drop with 429 so
      // the caller knows to back off — but still log the throttled attempt
      // so admins can see suspicious patterns.
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count } = await supabase
        .from("message_delivery_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", notifyData.user_id)
        .eq("recipient_channel", "in_app")
        .gte("created_at", oneMinuteAgo);

      if ((count ?? 0) >= NOTIFY_PER_USER_PER_MINUTE) {
        const { error: throttleLogError } = await supabase.from("message_delivery_log").insert({
          recipient_user_id: notifyData.user_id,
          recipient_channel: "in_app",
          template_name: notifyData.template_name ?? null,
          related_entity_type: notifyData.entity_type ?? null,
          related_entity_id: notifyData.entity_id ?? null,
          status: "throttled",
        });
        if (throttleLogError) {
          logError("delivery_log throttled-insert failed", throttleLogError, {
            tag: "n8n-webhook", channel: "in_app", status: "throttled",
          });
        }
        return NextResponse.json(
          { error: "rate_limited", limit: NOTIFY_PER_USER_PER_MINUTE, window: "1m" },
          { status: 429 },
        );
      }

      // Route through the dispatcher (audit H15) so in_app_enabled / quiet-hours
      // / important_only_mode preference gating is enforced. The previous direct
      // notifications insert bypassed all of it — the "gating handled n8n-side"
      // claim was unsupported (n8n has no read access to communication_preferences).
      // notify() writes its own message_delivery_log, so no manual "sent" mirror.
      try {
        await notify({
          userId: notifyData.user_id,
          type: (notifyData.type ?? "system") as NotifType,
          title: notifyData.title,
          body: notifyData.body ?? undefined,
          entityType: notifyData.entity_type ?? undefined,
          entityId: notifyData.entity_id ?? undefined,
          templateName: notifyData.template_name ?? undefined,
          urgent: notifyData.urgent ?? undefined,
          data: notifyData.data ?? undefined,
        });
      } catch (err) {
        logError("n8n webhook notify failed", err, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            user_id: notifyData.user_id,
            type: notifyData.type ?? "system",
            template_name: notifyData.template_name ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
      }

      return NextResponse.json({ notified: true });
    }

    case "check_idempotency": {
      const idemParsed = CheckIdempotencySchema.safeParse(data);
      if (!idemParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: idemParsed.error.flatten() },
          { status: 422 },
        );
      }
      // Check if an idempotency key already exists
      const { data: existing } = await supabase
        .from("automation_logs")
        .select("id")
        .eq("idempotency_key", idemParsed.data.idempotency_key)
        .eq("status", "succeeded")
        .returns<{ id: string }[]>()
        .single();
      return NextResponse.json({ exists: !!existing });
    }

    case "monthly_report_ready": {
      // T012 — on n8n callback after monthly_report.ready dispatch, insert in-app notification.
      const reportParsed = MonthlyReportReadySchema.safeParse(data);
      if (!reportParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: reportParsed.error.flatten() },
          { status: 422 },
        );
      }
      const reportData = reportParsed.data;
      const { routeInAppNotification: routeReport } = await import("@/lib/domains/notifications/routing");
      await routeReport({
        recipientId: reportData.student_id,
        trigger: "monthly_report.ready",
        subjectKey: `report:${reportData.student_id}:${reportData.year}:${reportData.month}`,
        ctx: {
          period: `${reportData.year}/${String(reportData.month).padStart(2, "0")}`,
        },
        data: { student_id: reportData.student_id, year: reportData.year, month: reportData.month, version: reportData.version },
      });
      return NextResponse.json({ notified: true });
    }

    case "certificate_earned": {
      // T016 — issue certificate + notify student and linked guardians.
      const certParsed = CertificateEarnedSchema.safeParse(data);
      if (!certParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: certParsed.error.flatten() },
          { status: 422 },
        );
      }
      const certData = certParsed.data;
      const { issueCertificate } = await import("@/lib/domains/certificates/issue");
      const result = await issueCertificate(certData.student_id, certData.type, certData.milestone_key);
      if (!result.ok) {
        logError("certificate_earned webhook: issueCertificate failed", new Error(result.error), {
          tag: "certificate",
        });
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      // T021 — for course_completion, attach next-product suggestion to notification payload.
      let nextProduct: { id: string; title_ar: string; title_en: string | null; price_cents: number; currency: string } | null = null;
      if (certData.type === "course_completion") {
        const { suggestNextProduct } = await import("@/lib/domains/certificates/next-product");
        nextProduct = await suggestNextProduct(certData.student_id, certData.milestone_key).catch(() => null);
      }

      const { routeInAppNotification: routeCert } = await import("@/lib/domains/notifications/routing");
      await routeCert({
        recipientId: certData.student_id,
        trigger: "certificate.earned",
        subjectKey: `cert:${certData.student_id}:${certData.type}:${certData.milestone_key}`,
        data: {
          certificate_id: result.certificate.id,
          ...(nextProduct ? { next_product: nextProduct } : {}),
        },
      });
      const { data: guardians, error: guardiansErr } = await supabase
        .from("guardian_children")
        .select("guardian_id")
        .eq("child_id", certData.student_id);
      if (guardiansErr) {
        logError("certificate_earned webhook: guardian lookup failed", guardiansErr, {
          tag: "certificate",
          student_id: certData.student_id,
        });
        return NextResponse.json({ error: "guardian lookup failed" }, { status: 500 });
      }
      if (guardians) {
        for (const g of guardians) {
          await routeCert({
            recipientId: g.guardian_id,
            trigger: "certificate.earned",
            subjectKey: `cert:${g.guardian_id}:${certData.student_id}:${certData.type}:${certData.milestone_key}`,
            data: {
              certificate_id: result.certificate.id,
              student_id: certData.student_id,
              ...(nextProduct ? { next_product: nextProduct } : {}),
            },
          }).catch((err) => logError("guardian cert notify failed", err, {}));
        }
      }
      return NextResponse.json({
        issued: !result.idempotent,
        idempotent: result.idempotent,
        certificate_id: result.certificate.id,
        next_product: nextProduct,
      });
    }

    case "subscription_past_due": {
      // T029 — consumed from spec 018; route dunning notification.
      const pastDueParsed = SubscriptionPastDueSchema.safeParse(data);
      if (!pastDueParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: pastDueParsed.error.flatten() },
          { status: 422 },
        );
      }
      const pastDueData = pastDueParsed.data;
      const { routeInAppNotification: routePastDue } = await import("@/lib/domains/notifications/routing");
      await routePastDue({
        recipientId: pastDueData.student_id,
        trigger: "subscription.past_due",
        subjectKey: `past_due:${pastDueData.student_id}:${pastDueData.subscription_id ?? ""}`,
        ctx: { studentName: pastDueData.student_name ?? null },
        data: { subscription_id: pastDueData.subscription_id },
      });
      return NextResponse.json({ notified: true });
    }

    case "subscription_expiring": {
      // T029 — emitted locally by spec 023 nightly job; route expiry "continue?" prompt.
      const expiringParsed = SubscriptionExpiringSchema.safeParse(data);
      if (!expiringParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: expiringParsed.error.flatten() },
          { status: 422 },
        );
      }
      const expiringData = expiringParsed.data;
      const { routeInAppNotification: routeExpiring } = await import("@/lib/domains/notifications/routing");
      await routeExpiring({
        recipientId: expiringData.student_id,
        trigger: "subscription.expiring",
        subjectKey: `expiring:${expiringData.student_id}:${expiringData.period_end ?? ""}`,
        ctx: { studentName: expiringData.student_name ?? null },
        data: { subscription_id: expiringData.subscription_id, period_end: expiringData.period_end },
      });
      return NextResponse.json({ notified: true });
    }

    case "absence_outcome": {
      // T029 — emitted locally by spec 023 scheduled job; route absence/excuse outcome.
      const absenceParsed = AbsenceOutcomeSchema.safeParse(data);
      if (!absenceParsed.success) {
        return NextResponse.json(
          { error: "invalid payload", issues: absenceParsed.error.flatten() },
          { status: 422 },
        );
      }
      const absenceData = absenceParsed.data;
      const { routeInAppNotification: routeAbsence } = await import("@/lib/domains/notifications/routing");
      await routeAbsence({
        recipientId: absenceData.student_id,
        trigger: "absence.outcome",
        subjectKey: `absence:${absenceData.student_id}:${absenceData.attendance_id ?? ""}`,
        ctx: { studentName: absenceData.student_name ?? null },
        data: { attendance_id: absenceData.attendance_id },
      });
      return NextResponse.json({ notified: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  } catch (err) {
    logError("n8n webhook handler threw", err, {
      tag: "n8n-webhook",
      severity: "critical",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

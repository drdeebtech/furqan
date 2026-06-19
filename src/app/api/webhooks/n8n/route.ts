import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, ...data } = body;

  const supabase = createAdminClient();

  switch (action) {
    case "log": {
      // Write automation log entry
      const { error } = await supabase.from("automation_logs").insert({
        workflow_name: data.workflow_name,
        event_name: data.event_name ?? null,
        entity_type: data.entity_type ?? null,
        entity_id: data.entity_id ?? null,
        idempotency_key: data.idempotency_key ?? null,
        status: data.status ?? "succeeded",
        channel: data.channel ?? null,
        payload_json: data.payload ?? null,
        result_json: data.result ?? null,
        error_message: data.error_message ?? null,
        finished_at: new Date().toISOString(),
      });
      if (error) {
        logError("n8n webhook log insert failed", error, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            workflow_name: data.workflow_name,
            event_name: data.event_name ?? null,
            entity_type: data.entity_type ?? null,
            entity_id: data.entity_id ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to log" }, { status: 500 });
      }
      return NextResponse.json({ logged: true });
    }

    case "notify": {
      // Per-user throttle: count in-app notifications delivered in the last
      // 60 seconds via this callback. If above the cap, drop with 429 so
      // the caller knows to back off — but still log the throttled attempt
      // so admins can see suspicious patterns.
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count } = await supabase
        .from("message_delivery_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", data.user_id)
        .eq("recipient_channel", "in_app")
        .gte("created_at", oneMinuteAgo);

      if ((count ?? 0) >= NOTIFY_PER_USER_PER_MINUTE) {
        const { error: throttleLogError } = await supabase.from("message_delivery_log").insert({
          recipient_user_id: data.user_id,
          recipient_channel: "in_app",
          template_name: data.template_name ?? null,
          related_entity_type: data.entity_type ?? null,
          related_entity_id: data.entity_id ?? null,
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
      // Validate required fields first (CodeRabbit) — a malformed payload should
      // 400, not dispatch a notification with a missing recipient/title.
      if (!data.user_id || !data.title) {
        return NextResponse.json(
          { error: "user_id and title are required" },
          { status: 400 },
        );
      }
      try {
        await notify({
          userId: data.user_id,
          type: data.type ?? "system",
          title: data.title,
          body: data.body ?? undefined,
          entityType: data.entity_type ?? undefined,
          entityId: data.entity_id ?? undefined,
          templateName: data.template_name ?? undefined,
          urgent: data.urgent ?? undefined,
          data: data.data ?? undefined,
        });
      } catch (err) {
        logError("n8n webhook notify failed", err, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            user_id: data.user_id,
            type: data.type ?? "system",
            template_name: data.template_name ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
      }

      return NextResponse.json({ notified: true });
    }

    case "check_idempotency": {
      // Check if an idempotency key already exists
      const { data: existing } = await supabase
        .from("automation_logs")
        .select("id")
        .eq("idempotency_key", data.idempotency_key)
        .eq("status", "succeeded")
        .returns<{ id: string }[]>()
        .single();
      return NextResponse.json({ exists: !!existing });
    }

    case "monthly_report_ready": {
      // T012 — on n8n callback after monthly_report.ready dispatch, insert in-app notification.
      if (!data.student_id) {
        return NextResponse.json({ error: "student_id required" }, { status: 400 });
      }
      const { routeInAppNotification: routeReport } = await import("@/lib/domains/notifications/routing");
      await routeReport({
        recipientId: data.student_id as string,
        trigger: "monthly_report.ready",
        subjectKey: `report:${data.student_id}:${data.year}:${data.month}`,
        ctx: {
          period:
            data.year != null && data.month != null
              ? `${data.year}/${String(data.month).padStart(2, "0")}`
              : undefined,
        },
        data: { student_id: data.student_id, year: data.year, month: data.month, version: data.version },
      });
      return NextResponse.json({ notified: true });
    }

    case "certificate_earned": {
      // T016 — issue certificate + notify student and linked guardians.
      if (!data.student_id || !data.type || !data.milestone_key) {
        return NextResponse.json(
          { error: "student_id, type, milestone_key required" },
          { status: 400 },
        );
      }
      const { issueCertificate } = await import("@/lib/domains/certificates/issue");
      const result = await issueCertificate(
        data.student_id as string,
        data.type as "appreciation_juz" | "appreciation_level" | "course_completion",
        data.milestone_key as string,
      );
      if (!result.ok) {
        logError("certificate_earned webhook: issueCertificate failed", new Error(result.error), {
          tag: "certificate",
        });
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      const { routeInAppNotification: routeCert } = await import("@/lib/domains/notifications/routing");
      await routeCert({
        recipientId: data.student_id as string,
        trigger: "certificate.earned",
        subjectKey: `cert:${data.student_id}:${data.type}:${data.milestone_key}`,
        data: { certificate_id: result.certificate.id },
      });
      const { data: guardians } = await supabase
        .from("guardian_children")
        .select("guardian_id")
        .eq("child_id", data.student_id as string)
        .returns<{ guardian_id: string }[]>();
      if (guardians) {
        for (const g of guardians) {
          await routeCert({
            recipientId: g.guardian_id,
            trigger: "certificate.earned",
            subjectKey: `cert:${g.guardian_id}:${data.student_id}:${data.type}:${data.milestone_key}`,
            data: { certificate_id: result.certificate.id, student_id: data.student_id },
          }).catch((err) => logError("guardian cert notify failed", err, {}));
        }
      }
      return NextResponse.json({
        issued: !result.idempotent,
        idempotent: result.idempotent,
        certificate_id: result.certificate.id,
      });
    }

    case "subscription_past_due": {
      // T029 — consumed from spec 018; route dunning notification.
      if (!data.student_id) {
        return NextResponse.json({ error: "student_id required" }, { status: 400 });
      }
      const { routeInAppNotification: routePastDue } = await import("@/lib/domains/notifications/routing");
      await routePastDue({
        recipientId: data.student_id as string,
        trigger: "subscription.past_due",
        subjectKey: `past_due:${data.student_id}:${data.subscription_id ?? ""}`,
        ctx: { studentName: (data.student_name as string | null) ?? null },
        data: { subscription_id: data.subscription_id },
      });
      return NextResponse.json({ notified: true });
    }

    case "subscription_expiring": {
      // T029 — emitted locally by spec 023 nightly job; route expiry "continue?" prompt.
      if (!data.student_id) {
        return NextResponse.json({ error: "student_id required" }, { status: 400 });
      }
      const { routeInAppNotification: routeExpiring } = await import("@/lib/domains/notifications/routing");
      await routeExpiring({
        recipientId: data.student_id as string,
        trigger: "subscription.expiring",
        subjectKey: `expiring:${data.student_id}:${data.period_end ?? ""}`,
        ctx: { studentName: (data.student_name as string | null) ?? null },
        data: { subscription_id: data.subscription_id, period_end: data.period_end },
      });
      return NextResponse.json({ notified: true });
    }

    case "absence_outcome": {
      // T029 — emitted locally by spec 023 scheduled job; route absence/excuse outcome.
      if (!data.student_id) {
        return NextResponse.json({ error: "student_id required" }, { status: 400 });
      }
      const { routeInAppNotification: routeAbsence } = await import("@/lib/domains/notifications/routing");
      await routeAbsence({
        recipientId: data.student_id as string,
        trigger: "absence.outcome",
        subjectKey: `absence:${data.student_id}:${data.attendance_id ?? ""}`,
        ctx: { studentName: (data.student_name as string | null) ?? null },
        data: { attendance_id: data.attendance_id },
      });
      return NextResponse.json({ notified: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
  } catch (err) {
    logError("n8n webhook handler threw", err, {
      tag: "n8n-webhook",
      severity: "critical",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

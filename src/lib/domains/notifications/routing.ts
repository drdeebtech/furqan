import "server-only";

import { getSetting } from "@/lib/settings";
import { notify } from "@/lib/notifications/dispatcher";

/** Spec 023 trigger set after round-2 clarification. */
export type NotificationTrigger =
  | "subscription.past_due"
  | "subscription.expiring"
  | "absence.outcome"
  | "monthly_report.ready"
  | "certificate.earned";

export type NotificationChannel = "in_app" | "email" | "push" | "whatsapp";

/**
 * FR-012 default trigger → channel[] matrix. Admin can override per deployment
 * via `platform_settings.notification_channel_matrix` (JSON map trigger→channel[]).
 */
export const DEFAULT_CHANNEL_MATRIX: Record<NotificationTrigger, NotificationChannel[]> = {
  "subscription.past_due": ["in_app", "email", "whatsapp"],
  "subscription.expiring": ["in_app", "email", "whatsapp"],
  "absence.outcome": ["in_app", "email"],
  "monthly_report.ready": ["in_app", "email"],
  "certificate.earned": ["in_app"],
};

const CRLF_REGEX = /[\r\n]/g;

export function sanitizeHeaderField(value: string): string {
  return (value ?? "").replace(CRLF_REGEX, " ").trim();
}

export async function resolveChannels(
  trigger: NotificationTrigger,
): Promise<NotificationChannel[]> {
  const defaultChannels = DEFAULT_CHANNEL_MATRIX[trigger] ?? ["in_app"];
  const rawMatrix = await getSetting("notification_channel_matrix");
  const whatsappEnabled = (await getSetting("notifications_whatsapp_enabled")) !== "false";

  let channels: NotificationChannel[] = defaultChannels;

  if (rawMatrix) {
    try {
      const parsed = JSON.parse(rawMatrix) as Record<string, NotificationChannel[]>;
      const override = parsed[trigger];
      if (Array.isArray(override) && override.length > 0) {
        const allowed: NotificationChannel[] = ["in_app", "email", "push", "whatsapp"];
        const filtered = override.filter((c): c is NotificationChannel => allowed.includes(c));
        channels = filtered.length > 0 ? filtered : defaultChannels;
      }
    } catch {
      // Invalid override → fall back to defaults.
    }
  }

  if (!whatsappEnabled) {
    channels = channels.filter((c) => c !== "whatsapp");
  }

  return channels;
}

export function buildNotificationContent(
  trigger: NotificationTrigger,
  ctx: { studentName?: string | null; period?: string },
): { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string } {
  switch (trigger) {
    case "subscription.past_due":
      return {
        titleAr: "تنبيه: فشل الدفع — حسابك معرّض للإيقاف",
        titleEn: "Heads up: payment failed — your subscription is at risk",
        bodyAr: `لم نتمكن من معالجة دفعتك${ctx.studentName ? ` مقابل اشتراك ${ctx.studentName}` : ""}. يُرجى تحديث وسيلة الدفع لتجنّب إيقاف الوصول.`,
        bodyEn: `We couldn't process your payment${ctx.studentName ? ` for ${ctx.studentName}'s subscription` : ""}. Please update your payment method to avoid losing access.`,
      };
    case "subscription.expiring":
      return {
        titleAr: "اشتراكك على وشك الانتهاء — جدّد الآن",
        titleEn: "Your subscription is expiring soon — renew now",
        bodyAr: `ينتهي اشتراكك${ctx.studentName ? ` الخاص بـ${ctx.studentName}` : ""} قريبًا. جدّد الآن للاستمرار في الحصص.`,
        bodyEn: `Your${ctx.studentName ? ` ${ctx.studentName}'s` : ""} subscription ends soon. Renew now to keep sessions going.`,
      };
    case "absence.outcome":
      return {
        titleAr: "نتيجة الغياب",
        titleEn: "Absence outcome",
        bodyAr: `تم تسجيل نتيجة الغياب${ctx.studentName ? ` لـ${ctx.studentName}` : ""}.`,
        bodyEn: `An absence outcome was recorded${ctx.studentName ? ` for ${ctx.studentName}` : ""}.`,
      };
    case "monthly_report.ready":
      return {
        titleAr: "تقرير الشهر جاهز",
        titleEn: "Monthly report ready",
        bodyAr: `تقرير${ctx.studentName ? ` ${ctx.studentName}` : ""} الشهري${ctx.period ? ` (${ctx.period})` : ""} جاهز للقراءة.`,
        bodyEn: `${ctx.studentName ? `${ctx.studentName}'s` : "The"} monthly report${ctx.period ? ` (${ctx.period})` : ""} is ready to read.`,
      };
    case "certificate.earned":
      return {
        titleAr: "شهادة جديدة! 🎉",
        titleEn: "New certificate! 🎉",
        bodyAr: `حصل${ctx.studentName ? ` ${ctx.studentName}` : ""} على شهادة تقدير. اضغط لعرضها.`,
        bodyEn: `${ctx.studentName ? `${ctx.studentName} earned` : "Earned"} an appreciation certificate. Tap to view.`,
      };
  }
}

/**
 * Route the in-app part immediately using the existing dispatcher. Email /
 * WhatsApp dispatch remains n8n-owned; the caller forwards the same trigger +
 * payload to n8n separately.
 */
export async function routeInAppNotification(args: {
  recipientId: string;
  trigger: NotificationTrigger;
  subjectKey: string;
  ctx?: { studentName?: string | null; period?: string };
  data?: Record<string, unknown>;
}): Promise<{ channels: NotificationChannel[] }> {
  const channels = await resolveChannels(args.trigger);
  const content = buildNotificationContent(args.trigger, args.ctx ?? {});

  if (channels.includes("in_app")) {
    await notify({
      userId: args.recipientId,
      type: args.trigger === "certificate.earned" || args.trigger === "monthly_report.ready" ? "system" : "payment",
      title: sanitizeHeaderField(content.titleEn),
      body: content.bodyEn,
      data: args.data,
      entityType: "notification",
      entityId: args.subjectKey,
      templateName: args.trigger,
      urgent: args.trigger === "subscription.past_due" || args.trigger === "subscription.expiring",
    });
  }

  return { channels };
}

import type { Metadata } from "next";
import { Bell, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { getRecentBroadcasts } from "@/lib/notifications/queries";
import { NotificationForm } from "./notification-form";

interface DeliveryFailureRow {
  id: string;
  recipient_channel: string;
  template_name: string | null;
  failure_reason: string | null;
  created_at: string;
}

export const metadata: Metadata = { title: "الإشعارات" };

export default async function AdminNotificationsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  // Tag-cached read; invalidated by sendNotification via revalidateTag.
  const recent = await getRecentBroadcasts(20);

  // F6: surface delivery failures from message_delivery_log so ops can see
  // when in-app/email/whatsapp/telegram dispatches silently fail. Read is
  // RLS-gated by admin_mod_read_delivery_log policy.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: failures } = await supabase
    .from("message_delivery_log")
    .select("id, recipient_channel, template_name, failure_reason, created_at")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<DeliveryFailureRow[]>();

  const failuresByChannel = new Map<string, number>();
  for (const f of failures ?? []) {
    failuresByChannel.set(f.recipient_channel, (failuresByChannel.get(f.recipient_channel) ?? 0) + 1);
  }
  const totalFailures = failures?.length ?? 0;

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Bell size={24} className="text-gold" /> {t("الإشعارات", "Notifications")}</h1>

      {totalFailures > 0 && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" aria-hidden />
            <h2 className="font-bold text-red-500">
              {t("إخفاقات التسليم — آخر 24 ساعة", "Delivery failures — last 24h")}
            </h2>
            <span className="ms-auto rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-500">
              {totalFailures}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {Array.from(failuresByChannel.entries()).map(([channel, count]) => (
              <span key={channel} className="rounded-full border border-line bg-surface-2 px-2 py-1">
                <span className="font-medium">{channel}</span>
                <span className="ms-1 text-muted">·</span>
                <span className="ms-1">{count}</span>
              </span>
            ))}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-fg">
              {t("عرض آخر الإخفاقات", "Show recent failures")}
            </summary>
            <ul className="mt-2 space-y-1">
              {(failures ?? []).slice(0, 10).map((f) => (
                <li key={f.id} className="rounded bg-surface-2 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px]">
                      [{f.recipient_channel}] {f.template_name ?? "—"}
                    </span>
                    <span className="text-[11px] text-muted" suppressHydrationWarning>
                      {new Date(f.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { timeZone: "UTC" })}
                    </span>
                  </div>
                  {f.failure_reason && (
                    <p className="mt-1 text-[11px] text-red-400/80">{f.failure_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <NotificationForm />

      {recent.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-bold">{t("آخر الإشعارات المرسلة", "Recent Sent Notifications")}</h2>
          <div className="space-y-2">
            {recent.map(n => (
              <div key={n.id} className="glass-card rounded-lg px-4 py-3">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{new Date(n.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { timeZone: "UTC" })}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen, Calendar, MessageSquare, Megaphone, CreditCard, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { markAsRead } from "@/lib/actions/notifications";
import { notificationHref } from "@/lib/notifications/href";
import type { Notification, NotifType } from "@/types/database";

export const metadata: Metadata = { title: "الإشعار" };

const ICONS: Record<NotifType, { Icon: typeof Bell; color: string; bg: string }> = {
  booking: { Icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/10" },
  payment: { Icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  message: { Icon: MessageSquare, color: "text-purple-400", bg: "bg-purple-500/10" },
  reminder: { Icon: Bell, color: "text-amber-400", bg: "bg-amber-500/10" },
  system: { Icon: Megaphone, color: "text-gold", bg: "bg-gold/10" },
  homework: { Icon: BookOpen, color: "text-sky-400", bg: "bg-sky-500/10" },
};

export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: notification } = await supabase
    .from("notifications")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single<Notification>();

  if (!notification) notFound();

  // Auto-mark-read on view
  if (!notification.is_read) {
    await markAsRead(notification.id);
  }

  const cfg = ICONS[notification.type] ?? ICONS.system;
  const { Icon } = cfg;
  const date = new Date(notification.created_at);
  // When this notification carries a linked resource, offer a CTA to open it.
  // notificationHref will return null for system-type — in that case the page
  // is just the standalone view.
  const linkedHref = notificationHref(notification, "/student");

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/student/notifications"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover"
      >
        <ArrowRight size={14} />
        {t("العودة للإشعارات", "Back to Notifications")}
      </Link>

      <div className="glass-card p-6">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
            <Icon size={22} className={cfg.color} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{notification.title}</h1>
            <p className="mt-1 text-xs text-muted">
              {date.toLocaleDateString(locale, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              {" · "}
              {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>

        {notification.body && (
          <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {notification.body}
          </div>
        )}

        {linkedHref && linkedHref !== `/student/notifications/${id}` && (
          <Link
            href={linkedHref}
            className="mt-6 inline-flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-semibold transition-colors"
          >
            {t("فتح المورد المرتبط", "Open linked resource")}
          </Link>
        )}
      </div>
    </div>
  );
}

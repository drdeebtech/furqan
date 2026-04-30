"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, Calendar, MessageSquare, Megaphone, CreditCard, Check, CheckCheck, Trash2, GraduationCap } from "lucide-react";
import { markAsRead, markAllAsRead, deleteNotification } from "@/lib/actions/notifications";
import { notificationHref } from "@/lib/notifications/href";
import { useLang } from "@/lib/i18n/context";
import type { Notification, NotifType } from "@/types/database";

const TYPE_CONFIG: Record<NotifType, { icon: typeof Bell; color: string; bg: string }> = {
  booking: { icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/10" },
  payment: { icon: CreditCard, color: "text-success", bg: "bg-success/10" },
  message: { icon: MessageSquare, color: "text-purple-400", bg: "bg-purple-500/10" },
  reminder: { icon: Bell, color: "text-warning", bg: "bg-warning/10" },
  system: { icon: Megaphone, color: "text-gold", bg: "bg-gold/10" },
  homework: { icon: BookOpen, color: "text-gold", bg: "bg-gold/10" },
  course: { icon: GraduationCap, color: "text-gold", bg: "bg-gold/10" },
};

export function NotificationsList({
  notifications: initial,
  rolePrefix = "/student",
}: {
  notifications: Notification[];
  rolePrefix?: string;
}) {
  const { t, lang } = useLang();
  const pathname = usePathname();
  // Infer the prefix from the current URL if not explicitly set — keeps the
  // teacher/admin pages working without needing to thread the prop.
  const inferredPrefix = pathname.startsWith("/teacher")
    ? "/teacher"
    : pathname.startsWith("/admin")
      ? "/admin"
      : pathname.startsWith("/moderator")
        ? "/moderator"
        : rolePrefix;
  const locale = lang === "ar" ? "ar" : "en-US";
  const [notifications, setNotifications] = useState(initial);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  async function handleMarkRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await markAsRead(id);
  }

  async function handleMarkAllRead() {
    setLoading(true);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    await markAllAsRead();
    setLoading(false);
  }

  async function handleDelete(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await deleteNotification(id);
  }

  return (
    <div>
      {/* Header actions */}
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-muted">
            {unreadCount} {t("غير مقروءة", "unread")}
          </span>
          <button
            onClick={handleMarkAllRead}
            disabled={loading}
            className="flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover disabled:opacity-50"
          >
            <CheckCheck size={14} />
            {t("قراءة الكل", "Mark all read")}
          </button>
        </div>
      )}

      {/* Notifications */}
      <div className="space-y-2">
        {notifications.map(n => {
          const config = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
          const Icon = config.icon;
          const date = new Date(n.created_at);
          const href = notificationHref(n, inferredPrefix);

          const body = (
            <>
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${config.bg}`}>
                <Icon size={18} className={config.color} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-sm ${!n.is_read ? "font-semibold" : ""}`}>
                      {!n.is_read && <span className="me-1 inline-block h-2 w-2 rounded-full bg-gold align-middle" />}
                      {n.title}
                    </p>
                    {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleMarkRead(n.id);
                        }}
                        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-gold"
                        title={t("تم القراءة", "Mark read")}
                      >
                        <Check size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(n.id);
                      }}
                      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-error"
                      title={t("حذف", "Delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted/60">
                  {date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
                  {" · "}
                  {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </>
          );

          const sharedClass = `glass-card flex items-start gap-4 p-4 text-start transition-colors hover:border-gold/30 ${!n.is_read ? "border-gold/20 bg-gold/5" : ""}`;

          return (
            <Link
              key={n.id}
              href={href}
              onClick={() => {
                if (!n.is_read) handleMarkRead(n.id);
              }}
              className={sharedClass}
            >
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

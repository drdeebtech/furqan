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
      : rolePrefix;
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const [notifications, setNotifications] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Filter chips — help the student narrow when notifications pile up.
  // Counts come off the unfiltered set so the student sees how many of
  // each type exist before clicking. Type slugs match the notif_type
  // enum in the schema; ordering puts the highest-pedagogical-value
  // types first (follow-up + booking).
  const [activeFilter, setActiveFilter] = useState<NotifType | "all">("all");
  const typeCounts: Record<string, number> = {};
  for (const n of initial) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  const FILTER_ORDER: { key: NotifType | "all"; ar: string; en: string }[] = [
    { key: "all", ar: "الكل", en: "All" },
    { key: "homework", ar: "متابعات", en: "Follow-ups" },
    { key: "booking", ar: "حجوزات", en: "Bookings" },
    { key: "reminder", ar: "تذكيرات", en: "Reminders" },
    { key: "message", ar: "رسائل", en: "Messages" },
    { key: "course", ar: "دورات", en: "Courses" },
    { key: "payment", ar: "مدفوعات", en: "Payments" },
    { key: "system", ar: "النظام", en: "System" },
  ];
  const visibleNotifications = activeFilter === "all"
    ? notifications
    : notifications.filter(n => n.type === activeFilter);

  async function handleMarkRead(id: string) {
    const prevRead = notifications.find(n => n.id === id)?.is_read ?? false;
    setActionError(null);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    try {
      const result = await markAsRead(id);
      if (!result.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: prevRead } : n));
        setActionError(t("تعذّر تحديث الإشعار — حاول مجدداً", "Failed to update notification — please try again"));
      }
    } catch {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: prevRead } : n));
      setActionError(t("تعذّر تحديث الإشعار — حاول مجدداً", "Failed to update notification — please try again"));
    }
  }

  async function handleMarkAllRead() {
    const unreadIds = new Set(notifications.filter(n => !n.is_read).map(n => n.id));
    setActionError(null);
    setLoading(true);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try {
      const result = await markAllAsRead();
      if (!result.ok) {
        setNotifications(prev => prev.map(n => unreadIds.has(n.id) ? { ...n, is_read: false } : n));
        setActionError(t("تعذّر تحديث الإشعارات — حاول مجدداً", "Failed to update notifications — please try again"));
      }
    } catch {
      setNotifications(prev => prev.map(n => unreadIds.has(n.id) ? { ...n, is_read: false } : n));
      setActionError(t("تعذّر تحديث الإشعارات — حاول مجدداً", "Failed to update notifications — please try again"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    const deletedIndex = notifications.findIndex(n => n.id === id);
    const deletedItem = deletedIndex >= 0 ? notifications[deletedIndex] : undefined;
    setActionError(null);
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      const result = await deleteNotification(id);
      if (!result.ok) {
        if (deletedItem && deletedIndex >= 0) {
          setNotifications(prev => {
            if (prev.some(n => n.id === id)) return prev;
            const restored = [...prev];
            restored.splice(deletedIndex, 0, deletedItem);
            return restored;
          });
        }
        setActionError(t("تعذّر حذف الإشعار — حاول مجدداً", "Failed to delete notification — please try again"));
      }
    } catch {
      if (deletedItem && deletedIndex >= 0) {
        setNotifications(prev => {
          if (prev.some(n => n.id === id)) return prev;
          const restored = [...prev];
          restored.splice(deletedIndex, 0, deletedItem);
          return restored;
        });
      }
      setActionError(t("تعذّر حذف الإشعار — حاول مجدداً", "Failed to delete notification — please try again"));
    }
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

      {/* Filter chips — only render when there are >5 notifications and
          >1 distinct type. For shorter lists the filter is overhead. */}
      {initial.length > 5 && Object.keys(typeCounts).length > 1 && (
        <div className="mb-4 -mx-1 flex flex-wrap gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTER_ORDER.filter(f => f.key === "all" || typeCounts[f.key] > 0).map(f => {
            const count = f.key === "all" ? initial.length : typeCounts[f.key] ?? 0;
            const active = activeFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-ring ${
                  active
                    ? "border-gold/50 bg-gold/15 text-gold"
                    : "border-card-border bg-card/50 text-muted hover:border-card-border/60 hover:text-foreground/80"
                }`}
              >
                {t(f.ar, f.en)}
                <span className={`ms-1.5 text-[10px] tabular-nums ${active ? "text-gold/70" : "text-muted-light"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {actionError && (
        <p role="alert" className="mb-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {actionError}
        </p>
      )}

      {/* Notifications */}
      <div className="space-y-2">
        {visibleNotifications.length === 0 && (
          <p className="rounded-xl border border-card-border bg-card/40 p-4 text-center text-xs text-muted">
            {t("لا إشعارات في هذه الفئة", "No notifications in this category")}
          </p>
        )}
        {visibleNotifications.map(n => {
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

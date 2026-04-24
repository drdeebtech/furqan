"use client";

import { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { usePathname } from "next/navigation";
import { Bell, CheckCheck, BookOpen, Calendar, MessageSquare, Megaphone, CreditCard } from "lucide-react";
import Link from "next/link";
import { fetchNotifications, markAsRead, markAllAsRead } from "@/lib/actions/notifications";
import { notificationHref } from "@/lib/notifications/href";
import { useLang } from "@/lib/i18n/context";
import type { Notification, NotifType } from "@/types/database";

const TYPE_CONFIG: Record<NotifType, { icon: typeof Bell; color: string }> = {
  booking: { icon: Calendar, color: "text-blue-400" },
  payment: { icon: CreditCard, color: "text-emerald-400" },
  message: { icon: MessageSquare, color: "text-purple-400" },
  reminder: { icon: Bell, color: "text-amber-400" },
  system: { icon: Megaphone, color: "text-gold" },
  homework: { icon: BookOpen, color: "text-sky-400" },
};

export function NotificationBell() {
  const { t } = useLang();
  const pathname = usePathname();
  const rolePrefix = pathname.startsWith("/teacher") ? "/teacher" : pathname.startsWith("/admin") ? "/admin" : pathname.startsWith("/moderator") ? "/moderator" : "/student";
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const loadNotifications = useCallback(() => {
    fetchNotifications(15).then(result => {
      if (result.notifications) {
        startTransition(() => setNotifications(result.notifications));
      }
    });
  }, []);

  // Fetch on mount
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Refetch when dropdown opens
  useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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

  // Memoize now to avoid impure call during render
  const [now] = useState(() => Date.now());

  const timeAgo = useCallback((dateStr: string): string => {
    const diff = now - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("الآن", "now");
    if (mins < 60) return t(`${mins} د`, `${mins}m`);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t(`${hrs} س`, `${hrs}h`);
    const days = Math.floor(hrs / 24);
    return t(`${days} ي`, `${days}d`);
  }, [now, t]);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell button. NOTE: the count badge lives as a sibling of this button,
          not a child, because .glass applies overflow:hidden which clips any
          absolute child positioned outside the rounded-xl corners. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="glass flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-white/5"
      >
        <Bell size={18} className="text-[var(--muted)]" />
      </button>
      {unreadCount > 0 && (
        <span
          data-testid="notification-badge"
          className="pointer-events-none absolute -end-1 -top-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-md bg-red-500/90 px-1 text-[9px] font-bold leading-none text-white"
          style={{ boxShadow: "0 0 0 2px var(--surface)" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-96 overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-2xl sm:w-96">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
            <h3 className="text-sm font-semibold">{t("الإشعارات", "Notifications")}</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-gold transition-colors hover:text-gold-hover disabled:opacity-50"
              >
                <CheckCheck size={12} />
                {t("قراءة الكل", "Mark all read")}
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="mx-auto mb-2 text-muted/30" />
                <p className="text-sm text-muted">{t("لا توجد إشعارات", "No notifications")}</p>
              </div>
            ) : (
              <ul role="list">
                {notifications.map(n => {
                  const config = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
                  const Icon = config.icon;
                  const href = notificationHref(n, rolePrefix);
                  const rowClass = `flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-white/5 ${
                    !n.is_read ? "bg-gold/5" : ""
                  }`;
                  const inner = (
                    <>
                      <div className={`mt-0.5 shrink-0 ${config.color}`}>
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm ${!n.is_read ? "font-semibold" : "text-muted"}`}>{n.title}</p>
                          {!n.is_read && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />
                          )}
                        </div>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>
                        )}
                        <p className="mt-1 text-[10px] text-muted/60">{timeAgo(n.created_at)}</p>
                      </div>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => {
                            if (!n.is_read) handleMarkRead(n.id);
                            setOpen(false);
                          }}
                          className={rowClass}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => !n.is_read && handleMarkRead(n.id)}
                          className={rowClass}
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-[var(--surface-border)] px-4 py-2 text-center">
              <a href={`${rolePrefix}/notifications`} className="text-xs text-gold hover:text-gold-hover">
                {t("عرض الكل ←", "View All →")}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

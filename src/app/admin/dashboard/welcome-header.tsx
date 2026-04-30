"use client";

import { Activity, AlertTriangle, Radio } from "lucide-react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { CacheClearButton } from "./cache-clear-button";

interface AdminWelcomeHeaderProps {
  weekday: string;
  alertCount: number;
  activeSessionCount: number;
}

/**
 * Operator-tone welcome row for the admin dashboard. Different intent than
 * student/teacher: admins want signal, not warmth. Surfaces a global status
 * pill (alerts vs all-clear) and a live-sessions live link.
 */
export function AdminWelcomeHeader({ weekday, alertCount, activeSessionCount }: AdminWelcomeHeaderProps) {
  const { t } = useLang();

  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">
          {t("لوحة الإدارة", "Admin Dashboard")}
        </h1>
        <p className="mt-1 text-sm text-muted" aria-live="polite">
          {weekday}
          <span className="mx-2 text-muted-light" aria-hidden="true">·</span>
          {alertCount > 0
            ? <span className="text-warning">{t(`${alertCount} تنبيه يحتاج اهتماماً`, `${alertCount} alert${alertCount === 1 ? "" : "s"} need attention`)}</span>
            : <span>{t("كل شيء يسير على ما يرام", "All systems quiet")}</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activeSessionCount > 0 && (
          <Link
            href="/admin/sessions/live"
            className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success transition-colors hover:bg-success/15"
            aria-label={t("جلسات نشطة الآن — اضغط للمراقبة", "Active sessions now — click to monitor")}
          >
            <Radio size={12} className="animate-pulse" aria-hidden="true" />
            <span>{t(`${activeSessionCount} نشطة`, `${activeSessionCount} live`)}</span>
          </Link>
        )}
        <Link
          href="/admin/control-tower"
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/15"
        >
          <Activity size={12} aria-hidden="true" />
          <span>{t("مركز التحكم", "Control Tower")}</span>
        </Link>
        {alertCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            <AlertTriangle size={12} aria-hidden="true" />
            <span>{alertCount}</span>
          </span>
        )}
        <CacheClearButton />
      </div>
    </header>
  );
}

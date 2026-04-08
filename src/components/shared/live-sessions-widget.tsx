"use client";

import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "./widget-card";

interface LiveSession {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  timeRemaining?: string;
  progressPercent?: number;
}

interface LiveSessionsWidgetProps {
  sessions: LiveSession[];
  title: string;
  ongoingCount: number;
}

const BADGE_COLORS = [
  "bg-purple-500",
  "bg-blue-500",
  "bg-orange-500",
  "bg-green-500",
  "bg-pink-500",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
}

export function LiveSessionsWidget({ sessions, title, ongoingCount }: LiveSessionsWidgetProps) {
  const { t } = useLang();

  const headerAction = ongoingCount > 0 ? (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green,#22C55E)]" />
      <span className="text-xs text-[var(--accent-green,#22C55E)]">
        {ongoingCount} {t("نشط", "Ongoing")}
      </span>
    </div>
  ) : undefined;

  return (
    <WidgetCard title={title} headerAction={headerAction}>
      {sessions.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--muted)]">
          {t("لا توجد جلسات مباشرة الآن", "No live sessions right now")}
        </p>
      ) : (
        <div>
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center py-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${hashColor(session.title)}`}
              >
                {session.initials}
              </div>
              <div className="ms-3 min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                  {session.title}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{session.subtitle}</p>
              </div>
              <div className="text-end">
                {session.timeRemaining && (
                  <p className="font-mono text-[13px] text-[var(--foreground)]">
                    {session.timeRemaining}
                  </p>
                )}
                {session.progressPercent != null && (
                  <p className="mt-0.5 text-xs text-[var(--accent-green,#22C55E)]">
                    ⚡ {session.progressPercent}%
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

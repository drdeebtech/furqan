"use client";

import { useEffect, useState } from "react";
import { Circle, Clock, CheckCircle, XCircle, Radio } from "lucide-react";

type SessionState = "upcoming" | "live" | "ended" | "expired";

const STATE_CONFIG: Record<
  SessionState,
  { label: string; en: string; icon: typeof Circle; className: string }
> = {
  upcoming: {
    label: "قادمة",
    en: "Upcoming",
    icon: Clock,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  },
  live: {
    label: "جارية الآن",
    en: "Live",
    icon: Radio,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  ended: {
    label: "مكتملة",
    en: "Ended",
    icon: CheckCircle,
    className: "border-muted/30 bg-muted/10 text-muted",
  },
  expired: {
    label: "منتهية الصلاحية",
    en: "Expired",
    icon: XCircle,
    className: "border-red-500/30 bg-red-500/10 text-red-400",
  },
};

function computeState(
  scheduledAt: string,
  durationMin: number,
  expiresAt: string | null,
  endedAt: string | null,
): SessionState {
  if (endedAt) return "ended";
  const now = Date.now();
  if (expiresAt && new Date(expiresAt).getTime() < now) return "expired";
  const start = new Date(scheduledAt).getTime();
  const windowStart = start - 10 * 60 * 1000;
  const windowEnd = start + (durationMin + 30) * 60 * 1000;
  if (now >= windowStart && now < windowEnd) return "live";
  if (now < windowStart) return "upcoming";
  return "expired";
}

export function SessionStatus({
  scheduledAt,
  durationMin,
  expiresAt = null,
  endedAt = null,
  showLabel = true,
  size = "sm",
}: {
  scheduledAt: string;
  durationMin: number;
  expiresAt?: string | null;
  endedAt?: string | null;
  showLabel?: boolean;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<SessionState>(() =>
    computeState(scheduledAt, durationMin, expiresAt, endedAt),
  );

  useEffect(() => {
    const check = () =>
      setState(computeState(scheduledAt, durationMin, expiresAt, endedAt));
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [scheduledAt, durationMin, expiresAt, endedAt]);

  const config = STATE_CONFIG[state];
  const Icon = config.icon;
  const iconSize = size === "md" ? 16 : 12;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
        size === "md" ? "text-sm" : "text-xs"
      } ${config.className}`}
    >
      <Icon
        size={iconSize}
        className={state === "live" ? "animate-pulse" : ""}
      />
      {showLabel && config.label}
    </span>
  );
}

export { computeState, type SessionState };

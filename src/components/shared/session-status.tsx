"use client";

import { useEffect, useState } from "react";
import { Circle, Clock, CheckCircle, XCircle, Radio } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type SessionState = "upcoming" | "live" | "ended" | "expired";

const STATE_CONFIG: Record<
  SessionState,
  { label: string; en: string; icon: typeof Circle; className: string }
> = {
  upcoming: {
    label: "قادمة",
    en: "Upcoming",
    icon: Clock,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  live: {
    label: "جارية الآن",
    en: "Live",
    icon: Radio,
    className: "border-success/30 bg-success/10 text-success",
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
    className: "border-error/30 bg-error/10 text-error",
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
  const { lang } = useLang();
  // Hydration-safe initial state: deterministic (no Date.now() on server). The
  // useEffect below immediately recomputes the real state on mount, so the
  // "upcoming"/"ended" placeholder is invisible (<16ms before useEffect runs).
  const [state, setState] = useState<SessionState>(endedAt ? "ended" : "upcoming");

  useEffect(() => {
    const check = () =>
      setState(computeState(scheduledAt, durationMin, expiresAt, endedAt));
    check();
    // Stop polling for terminal states
    const currentState = computeState(scheduledAt, durationMin, expiresAt, endedAt);
    if (currentState === "ended" || currentState === "expired") return;
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [scheduledAt, durationMin, expiresAt, endedAt]);

  const config = STATE_CONFIG[state];
  const Icon = config.icon;
  const iconSize = size === "md" ? 16 : 12;

  return (
    <span
      className={`inline-flex items-center gap-1 glass-badge rounded-full px-2 py-0.5 transition-colors ${
        size === "md" ? "text-sm" : "text-xs"
      } ${config.className}`}
    >
      <Icon
        size={iconSize}
        className={state === "live" ? "animate-pulse" : ""}
      />
      {showLabel && (lang === "ar" ? config.label : config.en)}
    </span>
  );
}

export { computeState, type SessionState };

"use client";

import { useLang } from "@/lib/i18n/context";

interface SeverityBadgeProps {
  severity: "critical" | "warning" | "info";
}

const config = {
  critical: {
    classes: "bg-error/15 text-red-400 border-error/30",
    ar: "حرج",
    en: "Critical",
  },
  warning: {
    classes: "bg-warning/15 text-warning border-warning/30",
    ar: "تحذير",
    en: "Warning",
  },
  info: {
    classes: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    ar: "معلومة",
    en: "Info",
  },
} as const;

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const { t } = useLang();
  const { classes, ar, en } = config[severity];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {t(`${ar} (${en})`, `${en} (${ar})`)}
    </span>
  );
}

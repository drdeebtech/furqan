"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n/context";

export function LiveBadge({
  scheduledAt,
  durationMin,
  defaultLabel,
  className,
}: {
  scheduledAt: string;
  durationMin: number;
  defaultLabel: { ar: string; en: string };
  className: string;
}) {
  const { t } = useLang();
  const resolvedDefault = t(defaultLabel.ar, defaultLabel.en);
  const [label, setLabel] = useState(resolvedDefault);

  useEffect(() => {
    function check() {
      const now = Date.now();
      const start = new Date(scheduledAt).getTime();
      const end = start + durationMin * 60000;
      if (now >= start && now < end) {
        setLabel(t("جارية الآن", "Live now"));
      } else {
        setLabel(t(defaultLabel.ar, defaultLabel.en));
      }
    }
    check();
    const interval = setInterval(check, 30000); // re-check every 30s
    return () => clearInterval(interval);
  }, [scheduledAt, durationMin, defaultLabel, t]);

  return <span className={className}>{label}</span>;
}

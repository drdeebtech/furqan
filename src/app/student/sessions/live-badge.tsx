"use client";

import { useEffect, useState } from "react";

export function LiveBadge({
  scheduledAt,
  durationMin,
  defaultLabel,
  className,
}: {
  scheduledAt: string;
  durationMin: number;
  defaultLabel: string;
  className: string;
}) {
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    function check() {
      const now = Date.now();
      const start = new Date(scheduledAt).getTime();
      const end = start + durationMin * 60000;
      if (now >= start && now < end) {
        setLabel("جارية الآن");
      } else {
        setLabel(defaultLabel);
      }
    }
    check();
    const interval = setInterval(check, 30000); // re-check every 30s
    return () => clearInterval(interval);
  }, [scheduledAt, durationMin, defaultLabel]);

  return <span className={className}>{label}</span>;
}

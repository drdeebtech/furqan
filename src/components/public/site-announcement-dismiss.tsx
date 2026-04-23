"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Client island for the announcement banner. On mount, reads localStorage
 * for a prior dismissal and injects a <style> rule keyed to the announcement
 * id that hides the banner. Rendering this rule after hydration (via useEffect)
 * avoids any first-paint flash.
 *
 * The dismiss button itself is rendered in the top-right of the server-
 * rendered banner via absolute positioning — parent container provides
 * the relative context.
 */
export function SiteAnnouncementDismiss({ id }: { id: string }) {
  const storageKey = `furqan-announcement-dismissed-${id}`;
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(storageKey) === "1") {
        setDismissed(true);
      }
    } catch {
      /* privacy-mode browsers throw on localStorage access */
    }
  }, [storageKey]);

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (dismissed) {
    return (
      <style>{`[data-announcement-id="${id}"]{display:none;}`}</style>
    );
  }

  return (
    <button
      onClick={dismiss}
      aria-label="Dismiss announcement"
      className="absolute end-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-foreground"
    >
      <X size={14} />
    </button>
  );
}

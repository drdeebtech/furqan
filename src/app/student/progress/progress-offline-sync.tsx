"use client";

import { useEffect } from "react";
import { writeProgressSnapshot, type OfflineProgressSnapshot } from "@/lib/offline/progress-snapshot";

/**
 * Invisible writer (#527): persists the server-built progress snapshot to
 * localStorage on each online visit so the public `/offline` page can render it
 * with no network. Renders nothing.
 */
export function ProgressOfflineSync({ snapshot }: { snapshot: OfflineProgressSnapshot }) {
  useEffect(() => {
    writeProgressSnapshot(snapshot);
  }, [snapshot]);
  return null;
}

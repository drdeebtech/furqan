"use client";

import { useEffect } from "react";
import { subscribeToUserNotifications, isRealtimeConfigured } from "@/lib/realtime/supabase-realtime";
import { logError } from "@/lib/logger";

interface RealtimeProviderProps {
  userId: string;
  children?: React.ReactNode;
}

/**
 * Mounts a Supabase Realtime subscription for the authenticated user.
 *
 * On a new notification INSERT the server has already written the row.
 * We dispatch a poke ("furqan:notification:new") on document so
 * NotificationBell, NotificationsList, and JuzCelebration each re-fetch
 * from the RLS-guarded server action — the socket payload is never
 * trusted as a data source.
 *
 * Fail-soft: no-op when unconfigured; existing mount/refetch UX unchanged.
 */
export function RealtimeProvider({ userId, children }: RealtimeProviderProps) {
  useEffect(() => {
    if (!isRealtimeConfigured()) return;

    const unsubscribe = subscribeToUserNotifications(userId, () => {
      try {
        document.dispatchEvent(new CustomEvent("furqan:notification:new"));
      } catch (err) {
        logError("realtime poke dispatch failed", err, { tag: "realtime" });
      }
    });

    return unsubscribe;
  }, [userId]);

  // ponytail: wrapper-free — children renders as-is, provider is pure side-effect
  return <>{children}</>;
}

import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/logger";

/** True when the public Supabase env vars are present (always in prod). */
export function isRealtimeConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Subscribe to INSERT events on the `notifications` table for a specific user.
 * RLS enforces ownership — only rows where `user_id = userId` are delivered.
 * Returns an unsubscribe function; call it on cleanup.
 *
 * Fail-soft: returns a no-op unsubscribe when unconfigured. Never throws.
 */
export function subscribeToUserNotifications(
  userId: string,
  onInsert: () => void,
): () => void {
  if (!isRealtimeConfigured()) return () => {};

  const supabase = createClient();

  const channel = supabase
    .channel(`user-notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        try {
          onInsert();
        } catch (err) {
          logError("realtime notification callback failed", err, { tag: "realtime" });
        }
      },
    )
    .subscribe((status, err) => {
      if (err) {
        logError("realtime subscription error", err, { tag: "realtime", status });
      }
    });

  return () => {
    supabase.removeChannel(channel).catch((err) =>
      logError("realtime unsubscribe failed", err, { tag: "realtime" }),
    );
  };
}

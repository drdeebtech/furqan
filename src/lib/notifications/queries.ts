import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

interface NotifRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * Recent admin broadcast notifications (type = "system"). The same data is
 * shown to every admin viewing /admin/notifications, so caching on a single
 * tag is correct — there's no per-user variance.
 *
 * Mirrors the pattern in `src/lib/settings.ts#getSettings`:
 * - Admin client (no cookies()) so unstable_cache's "no dynamic APIs"
 *   rule is satisfied.
 * - 1-hour `revalidate` fallback in case a tag invalidation gets lost
 *   (defense in depth — won't usually fire because sendNotification
 *   always calls revalidateTag).
 *
 * Tag taxonomy: `notifications:admin:broadcasts` — broad scope, since
 * the broadcast list is admin-shared, not per-user.
 */
export const getRecentBroadcasts = unstable_cache(
  async (limit = 20): Promise<NotifRow[]> => {
    // admin: inside unstable_cache (cookies disallowed); reads notifications (issue #523)
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, body, is_read, created_at")
      .eq("type", "system")
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<NotifRow[]>();
    return data ?? [];
  },
  ["notifications:admin:broadcasts"],
  { tags: ["notifications:admin:broadcasts"], revalidate: 3600 },
);

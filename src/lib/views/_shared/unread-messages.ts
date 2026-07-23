import type { ServerClient } from "@/lib/supabase/types";

/**
 * The ONE unread-message-count filter, shared by the student dashboard, the
 * teacher dashboard, and `getUnreadMessageCount` — previously inlined
 * separately at all three sites with a divergent, wrong predicate (filtering
 * the dead `messages.deleted_at` column, which is never written, while
 * missing the real moderator `hidden_at` flag set by `admin/moderation/actions.ts`).
 *
 * Only the filter predicate is shared. Each call site still resolves its own
 * `convIds` and still drops this query into its own `Promise.all` batch —
 * this returns the unresolved query builder (not an awaited result) so it
 * composes into that batching unchanged.
 */
export function unreadMessagesFilter(
  supabase: ServerClient,
  convIds: string[],
  userId: string,
) {
  return supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", convIds)
    .neq("sender_id", userId)
    .eq("is_read", false)
    .is("hidden_at", null);
}

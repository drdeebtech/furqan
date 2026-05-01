import "server-only";
import { revalidateTag } from "next/cache";
import type { UserRole } from "@/types/database";

/**
 * Canonical tag for the per-user role cache used by `src/proxy.ts`.
 *
 *   const state = await unstable_cache(
 *     async () => fetchRoleState(),
 *     [...],
 *     { tags: [buildRoleTag(userId)], revalidate: 10 },
 *   )();
 *
 * The cached payload is `RoleState`: the user's *active* role plus the full
 * `roles[]` set they may switch into. Any server action that mutates either
 * column must call `invalidateRoleCache(userId)` after the DB write —
 * otherwise the demoted/promoted role can stick for up to the cache TTL
 * (10s) before the fallback revalidate kicks in.
 */
export type RoleState = {
  active: UserRole;
  roles: UserRole[];
};

export function buildRoleTag(userId: string): string {
  return `user-role:${userId}`;
}

export function invalidateRoleCache(userId: string): void {
  // Next 16 two-arg form. "max" expires every cacheLife profile attached to
  // this tag — correct for an admin write that should reflect immediately.
  revalidateTag(buildRoleTag(userId), "max");
}

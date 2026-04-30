import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Canonical tag for the per-user role cache used by `src/proxy.ts`.
 *
 *   const role = await unstable_cache(
 *     async () => /* fetch role */,
 *     [...],
 *     { tags: [buildRoleTag(userId)], revalidate: 10 },
 *   )();
 *
 * Any server action that mutates `profiles.role` must call
 * `invalidateRoleCache(userId)` after the DB write — otherwise the demoted
 * or promoted role can stick for up to the cache TTL (10s) before the
 * fallback revalidate kicks in. The TTL is the safety net; this function
 * is the precision tool.
 */
export function buildRoleTag(userId: string): string {
  return `user-role:${userId}`;
}

export function invalidateRoleCache(userId: string): void {
  // Next 16 two-arg form. "max" expires every cacheLife profile attached to
  // this tag — correct for an admin write that should reflect immediately.
  revalidateTag(buildRoleTag(userId), "max");
}

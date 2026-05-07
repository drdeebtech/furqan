/**
 * Pure role-check primitive — no Supabase, no server-only, no I/O. Used
 * internally by `requireRole` in `./require-admin.ts` to decide whether
 * the caller's already-fetched role is in the allowed set.
 *
 * Extracted to its own module so it can be unit-tested without the
 * server-only barrier on `require-admin.ts`. See ADR-0001.
 */

import type { UserRole } from "@/types/database";
import { ForbiddenError } from "./errors";

/**
 * Throws `ForbiddenError` if `actual` (the caller's current role) is not in
 * the `allowed` set, OR if `actual` is `null` (no role on the profile row).
 *
 * Returns nothing on success — the caller continues with whatever bookkeeping
 * it has already done (e.g., already extracted the user id).
 *
 * Authentication failure (no session) is NOT this function's concern — that
 * comes from the upstream `getAuthedRole()` which throws `UnauthenticatedError`
 * before this is ever called.
 */
export function assertRole(
  actual: UserRole | null,
  allowed: readonly UserRole[],
): void {
  if (!actual || !allowed.includes(actual)) {
    throw new ForbiddenError(`not ${allowed.join(" or ")}`);
  }
}

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/promise-utils";
import type { UserRole } from "@/types/database";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { assertRole } from "./role-check";

// Re-export so existing importers (`@/lib/auth/require-admin`) keep working
// unchanged. The classes themselves live in `./errors` so tests can import
// them without the server-only barrier (see require-admin.test.ts). The
// pure role-check primitive lives in `./role-check` for the same reason.
export { ForbiddenError, UnauthenticatedError };

// 4s is well below the Vercel function `maxDuration` for admin routes (30s)
// and well above any healthy auth round-trip (~50–300ms). If we cross it,
// something is really wrong upstream — bouncing to /login is safer than
// holding the page forever.
const AUTH_TIMEOUT_MS = 4000;

async function getAuthedRole(): Promise<{ id: string; role: UserRole | null }> {
  const supabase = await createClient();

  // Defensive: @supabase/ssr's session-construction can throw (separately
  // from the cookie filter in middleware) for shapes that pass shape but
  // fail decode — e.g. partial-write tokens during rotation. Treat any
  // throw OR hang as "not authenticated" rather than letting it bubble up
  // as a 500 / spin forever. (Incident 2026-05-04: layout-level auth check
  // hung for 1+ user, page never rendered because the auth gate never
  // resolved.)
  let userId: string | null = null;
  try {
    const { data } = await withTimeout(
      supabase.auth.getUser(),
      AUTH_TIMEOUT_MS,
      { data: { user: null }, error: null } as unknown as Awaited<
        ReturnType<typeof supabase.auth.getUser>
      >,
      "requireAdmin.getUser",
    );
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) throw new UnauthenticatedError();

  // Profile lookup uses .single() which returns { data: null, error: PGRST116 }
  // for zero rows — never throws on missing row. Wrap anyway for defense in
  // depth (network blip mid-query, schema drift, hang). null role propagates
  // to requireRole/requireAdmin/requireModerator which reject with
  // ForbiddenError, which the layout converts to redirect("/login").
  let role: UserRole | null = null;
  try {
    const { data: profile } = await withTimeout(
      supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<{ role: UserRole | null }>(),
      AUTH_TIMEOUT_MS,
      { data: null } as never,
      "requireAdmin.profileRole",
    );
    role = profile?.role ?? null;
  } catch {
    role = null;
  }

  return { id: userId, role };
}

/**
 * Canonical role-gating primitive. See ADR-0001.
 *
 * Single-role: `requireRole("admin")` → returns `{ id }`.
 * Multi-role:  `requireRole(["admin", "moderator"])` → returns `{ id, role }`
 *              with the matched role narrowed to the input union.
 *
 * Throws:
 *   - `UnauthenticatedError` (extends ForbiddenError) if no valid session.
 *   - `ForbiddenError` if session is valid but role isn't in the allowed set.
 *
 * The named sugar helpers (`requireAdmin`, `requireModerator`,
 * `requireAdminOrModerator`) are one-line wrappers over this primitive —
 * they exist for readability at common call sites. New code may use either.
 */
export async function requireRole(role: UserRole): Promise<{ id: string }>;
export async function requireRole<T extends UserRole>(
  roles: readonly T[],
): Promise<{ id: string; role: T }>;
export async function requireRole(
  roleOrRoles: UserRole | readonly UserRole[],
): Promise<{ id: string; role?: UserRole }> {
  const { id, role } = await getAuthedRole();
  const allowed = Array.isArray(roleOrRoles)
    ? (roleOrRoles as readonly UserRole[])
    : [roleOrRoles as UserRole];
  // Pure decision delegated to ./role-check so the logic is unit-tested
  // without the server-only barrier on this file. assertRole throws
  // ForbiddenError if role is null or not in allowed.
  assertRole(role, allowed);
  return Array.isArray(roleOrRoles) ? { id, role: role as UserRole } : { id };
}

/**
 * Sugar wrapper. `requireAdmin()` is equivalent to `requireRole("admin")`.
 */
export async function requireAdmin(): Promise<{ id: string }> {
  return requireRole("admin");
}

/**
 * Sugar wrapper. `requireModerator()` is equivalent to `requireRole("moderator")`.
 */
export async function requireModerator(): Promise<{ id: string }> {
  return requireRole("moderator");
}

/**
 * Sugar wrapper. `requireAdminOrModerator()` is equivalent to
 * `requireRole(["admin", "moderator"])`. Returns the matched role so callers
 * can branch on which one granted access.
 */
export async function requireAdminOrModerator(): Promise<{
  id: string;
  role: "admin" | "moderator";
}> {
  return requireRole(["admin", "moderator"] as const);
}

/**
 * API-route wrapper around `requireAdmin`. Returns the authed user, or a
 * NextResponse to short-circuit the handler on auth failure.
 *
 *   const guard = await requireAdminForApi();
 *   if (guard instanceof NextResponse) return guard;
 *   // guard.id is now the admin's user id
 */
export async function requireAdminForApi(): Promise<
  NextResponse | { id: string }
> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }
}

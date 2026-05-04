import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/promise-utils";

// 4s is well below the Vercel function `maxDuration` for admin routes (30s)
// and well above any healthy auth round-trip (~50–300ms). If we cross it,
// something is really wrong upstream — bouncing to /login is safer than
// holding the page forever.
const AUTH_TIMEOUT_MS = 4000;

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function getAuthedRole(): Promise<{ id: string; role: string | null }> {
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
  if (!userId) throw new ForbiddenError("not authenticated");

  // Profile lookup uses .single() which returns { data: null, error: PGRST116 }
  // for zero rows — never throws on missing row. Wrap anyway for defense in
  // depth (network blip mid-query, schema drift, hang). null role propagates
  // to requireAdmin/requireModerator which reject with "not admin"/"not
  // moderator", which the layout converts to redirect("/login").
  let role: string | null = null;
  try {
    const { data: profile } = await withTimeout(
      supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<{ role: string | null }>(),
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

export async function requireAdmin(): Promise<{ id: string }> {
  const { id, role } = await getAuthedRole();
  if (role !== "admin") throw new ForbiddenError("not admin");
  return { id };
}

export async function requireModerator(): Promise<{ id: string }> {
  const { id, role } = await getAuthedRole();
  if (role !== "moderator") throw new ForbiddenError("not moderator");
  return { id };
}

export async function requireAdminOrModerator(): Promise<{
  id: string;
  role: "admin" | "moderator";
}> {
  const { id, role } = await getAuthedRole();
  if (role !== "admin" && role !== "moderator") {
    throw new ForbiddenError("not admin or moderator");
  }
  return { id, role: role as "admin" | "moderator" };
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
    if (e instanceof ForbiddenError) {
      const unauthed = e.message === "not authenticated";
      return NextResponse.json(
        { error: unauthed ? "Unauthorized" : "Forbidden" },
        { status: unauthed ? 401 : 403 },
      );
    }
    throw e;
  }
}

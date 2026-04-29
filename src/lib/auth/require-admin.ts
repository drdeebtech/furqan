import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function getAuthedRole(): Promise<{ id: string; role: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ForbiddenError("not authenticated");

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string | null }>();

  return { id: user.id, role: data?.role ?? null };
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

import "server-only";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

type AdminUser = {
  admin: SupabaseClient<Database>;
  userId: string;
};

type AuthResult =
  | { ok: true; value: AdminUser }
  | { ok: false; response: NextResponse };

/**
 * Shared admin auth check for scheduling admin routes.
 * Extracts the bearer token, verifies the user, and confirms admin/super_admin role.
 */
export async function requireAdminUser(
  request: Request,
): Promise<AuthResult> {
  // admin: shared admin-auth helper; auth.admin API for impersonation/role lookup (issue #523)
  const admin = createAdminClient();

  const token = request.headers.get("Authorization")?.split(" ")[1] ?? "";
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);

  if (authErr || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Surface DB/profile retrieval failures as server errors so transient
  // outages are not misreported as authorization failures (which would
  // incorrectly deny access to valid admins).
  if (profileErr || !profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to load admin profile" },
        { status: 503 },
      ),
    };
  }

  // Allow the canonical "admin" role plus the defensive "super_admin" string
  // (not in the user_role enum today, kept for forward-compat). String
  // comparison avoids the `as any` cast against the typed enum.
  const role: unknown = profile?.role;
  const isAdmin =
    role === "admin" || role === "super_admin";
  if (!isAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, value: { admin, userId: user.id } };
}

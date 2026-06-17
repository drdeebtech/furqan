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
  const admin = createAdminClient();

  const token = request.headers.get("Authorization")?.split(" ")[1] ?? "";
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);

  if (authErr || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== ("super_admin" as any)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, value: { admin, userId: user.id } };
}

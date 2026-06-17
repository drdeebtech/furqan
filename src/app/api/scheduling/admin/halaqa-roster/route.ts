import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHalaqaRoster } from "@/lib/domains/scheduling/cohorts";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  classOfferingId: z.string().uuid(),
});

/**
 * GET /api/scheduling/admin/halaqa-roster — fetch halaqa roster.
 * Admin only.
 */
export async function GET(request: Request) {
  const admin = createAdminClient();
  
  // Auth check: verify admin role
  const { data: { user }, error: authErr } = await admin.auth.getUser(
    request.headers.get("Authorization")?.split(" ")[1] ?? ""
  );

  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role in profiles
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== ("super_admin" as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const result = querySchema.safeParse(Object.fromEntries(searchParams));

  if (!result.success) {
    return NextResponse.json({ error: "Invalid query parameters", details: result.error.format() }, { status: 400 });
  }

  const { classOfferingId } = result.data;

  try {
    const roster = await getHalaqaRoster(admin, classOfferingId);
    return NextResponse.json(roster);
  } catch (err: any) {
    if (err.message === "Halaqa not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logError("api/scheduling/admin/halaqa-roster: failed", err, { admin_id: user.id, class_offering_id: classOfferingId });
    return NextResponse.json({ error: "Failed to fetch halaqa roster" }, { status: 500 });
  }
}

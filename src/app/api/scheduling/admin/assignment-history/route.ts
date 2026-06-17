import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudentAssignmentHistory } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  studentId: z.string().uuid(),
});

/**
 * GET /api/scheduling/admin/assignment-history — fetch student's assignment history.
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

  const { studentId } = result.data;

  try {
    const history = await getStudentAssignmentHistory(admin, studentId);
    return NextResponse.json({ history });
  } catch (err) {
    logError("api/scheduling/admin/assignment-history: failed", err, { admin_id: user.id, student_id: studentId });
    return NextResponse.json({ error: "Failed to fetch assignment history" }, { status: 500 });
  }
}

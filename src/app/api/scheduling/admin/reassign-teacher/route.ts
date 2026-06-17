import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { reassignTeacher } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  assignmentId: z.string().uuid(),
  newTeacherId: z.string().uuid(),
  reason: z.string().min(1),
});

/**
 * POST /api/scheduling/admin/reassign-teacher — mid-month teacher change.
 * Admin only. Bulk-cancels future bookings.
 */
export async function POST(request: Request) {
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

  const body = await request.json();
  const result = bodySchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Invalid request body", details: result.error.format() }, { status: 400 });
  }

  const { assignmentId, newTeacherId, reason } = result.data;

  try {
    const reassignmentResult = await reassignTeacher(
      admin,
      assignmentId,
      newTeacherId,
      reason,
      user.id
    );

    return NextResponse.json(reassignmentResult, { status: 200 });
  } catch (err) {
    logError("api/scheduling/admin/reassign-teacher: failed", err, { admin_id: user.id, assignment_id: assignmentId });
    return NextResponse.json({ error: "Failed to reassign teacher" }, { status: 500 });
  }
}

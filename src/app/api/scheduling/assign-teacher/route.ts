import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAssignment } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  studentId: z.string().uuid(),
  teacherId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  productType: z.enum(["hifz_individual", "hifz_group", "course"]),
  lockMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/scheduling/assign-teacher — create a new teacher assignment.
 * Admin/service-role only.
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

  try {
    const assignmentId = await createAssignment(admin, {
      student_id: result.data.studentId,
      teacher_id: result.data.teacherId,
      subscription_id: result.data.subscriptionId,
      product_type: result.data.productType,
      lock_month: result.data.lockMonth,
      approved_by: user.id,
    });

    return NextResponse.json({ assignmentId }, { status: 201 });
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "Student already has an active assignment" }, { status: 409 });
    }
    logError("api/scheduling/assign-teacher: failed", err, { admin_id: user.id });
    return NextResponse.json({ error: "Failed to create assignment" }, { status: 500 });
  }
}

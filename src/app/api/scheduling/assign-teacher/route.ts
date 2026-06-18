import { NextResponse } from "next/server";
import { z } from "zod";
import { createAssignment } from "@/lib/domains/scheduling/assignments";
import { requireAdminUser } from "../_adminAuth";
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
  const auth = await requireAdminUser(request);
  if (!auth.ok) return auth.response;
  const { admin, userId } = auth.value;

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
      approved_by: userId,
    });

    return NextResponse.json({ assignmentId }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json({ error: "Student already has an active assignment" }, { status: 409 });
    }
    logError("api/scheduling/assign-teacher: failed", err, {});
    return NextResponse.json({ error: "Failed to create assignment" }, { status: 500 });
  }
}

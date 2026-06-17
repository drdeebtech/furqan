import { NextResponse } from "next/server";
import { z } from "zod";
import { reassignTeacher } from "@/lib/domains/scheduling/assignments";
import { requireAdminUser } from "../../_adminAuth";
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
  const auth = await requireAdminUser(request);
  if (!auth.ok) return auth.response;
  const { admin, userId } = auth.value;

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
      userId
    );

    return NextResponse.json(reassignmentResult, { status: 200 });
  } catch (err) {
    logError("api/scheduling/admin/reassign-teacher: failed", err, {});
    return NextResponse.json({ error: "Failed to reassign teacher" }, { status: 500 });
  }
}

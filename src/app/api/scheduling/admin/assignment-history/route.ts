import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudentAssignmentHistory } from "@/lib/domains/scheduling/assignments";
import { requireAdminUser } from "../../_adminAuth";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  studentId: z.string().uuid(),
});

/**
 * GET /api/scheduling/admin/assignment-history — fetch student's assignment history.
 * Admin only.
 */
export async function GET(request: Request) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) return auth.response;
  const { admin } = auth.value;

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
    logError("api/scheduling/admin/assignment-history: failed", err, {});
    return NextResponse.json({ error: "Failed to fetch assignment history" }, { status: 500 });
  }
}

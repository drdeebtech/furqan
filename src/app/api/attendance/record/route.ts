import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/app/api/scheduling/_adminAuth";
import { finalizeAttendance, BookingNotFoundError, FinalizeAttendanceError, type AttendanceOutcome } from "@/lib/domains/attendance/finalize";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  bookingId: z.string().uuid(),
  outcome: z.enum(["present", "student_absent", "teacher_absent", "excused_carried"]),
  actualTeacherId: z.string().uuid().optional(),
});

/**
 * POST /api/attendance/record — finalize a session outcome.
 * Admin/service-role only. Delegates to the finalize_attendance RPC.
 */
export async function POST(request: Request) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) return auth.response;
  const { admin, userId } = auth.value;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = bodySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid request body", details: result.error.format() }, { status: 400 });
  }

  try {
    await finalizeAttendance(
      admin,
      result.data.bookingId,
      result.data.outcome as AttendanceOutcome,
      result.data.actualTeacherId,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof FinalizeAttendanceError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logError("api/attendance/record: failed", err, {
      tag: "attendance",
      admin_id: userId,
      booking_id: result.data.bookingId,
    });
    return NextResponse.json({ error: "Failed to finalize attendance" }, { status: 500 });
  }
}

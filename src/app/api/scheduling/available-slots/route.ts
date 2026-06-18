import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOpenSlots } from "@/lib/domains/scheduling/availability";
import { getMyAssignment } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

// Validate `YYYY-MM` AND calendar correctness (rejects 2026-00 / 2026-13).
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((m) => {
    const [y, mo] = m.split("-").map(Number);
    return mo >= 1 && mo <= 12 && y >= 2000 && y <= 9999;
  }, "Invalid calendar month");

const querySchema = z.object({
  month: monthSchema.optional(),
});

/**
 * GET /api/scheduling/available-slots — fetch open slots for the caller's
 * assigned teacher. Student-scoped: the teacher is ALWAYS resolved from
 * the active assignment, never from a query param — otherwise a student
 * could enumerate any teacher's availability by passing an arbitrary
 * `teacherId`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const result = querySchema.safeParse(Object.fromEntries(searchParams));

  if (!result.success) {
    return NextResponse.json({ error: "Invalid query parameters", details: result.error.format() }, { status: 400 });
  }

  const { month } = result.data;

  // Always resolve the teacher from the caller's active assignment.
  const assignment = await getMyAssignment(supabase, user.id);
  if (!assignment) {
    return NextResponse.json({ slots: [] }); // No assignment, no slots
  }
  const targetTeacherId = assignment.teacher_id;

  try {
    const slots = await getOpenSlots(supabase, targetTeacherId, month);
    return NextResponse.json({ slots });
  } catch (err) {
    logError("api/scheduling/available-slots: failed", err, {
      tag: "scheduling",
      user_id: user.id,
      teacher_id: targetTeacherId,
      month: month ?? null,
    });
    return NextResponse.json({ error: "Failed to fetch available slots" }, { status: 500 });
  }
}

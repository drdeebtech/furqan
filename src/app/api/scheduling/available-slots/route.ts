import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOpenSlots } from "@/lib/domains/scheduling/availability";
import { getMyAssignment } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  teacherId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/**
 * GET /api/scheduling/available-slots — fetch open slots for a teacher.
 * If teacherId is omitted, resolves to the student's assigned teacher.
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

  const { teacherId, month } = result.data;

  try {
    let targetTeacherId = teacherId;

    if (!targetTeacherId) {
      const assignment = await getMyAssignment(supabase, user.id);
      if (!assignment) {
        return NextResponse.json({ slots: [] }); // No assignment, no slots
      }
      targetTeacherId = assignment.teacher_id;
    }

    const slots = await getOpenSlots(supabase, targetTeacherId, month);
    return NextResponse.json({ slots });
  } catch (err) {
    logError("api/scheduling/available-slots: failed", err, {
      tag: "scheduling",
      user_id: user.id,
      teacher_id: teacherId ?? null,
      month: month ?? null,
    });
    return NextResponse.json({ error: "Failed to fetch available slots" }, { status: 500 });
  }
}

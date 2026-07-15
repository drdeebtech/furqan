import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { canReadStudent } from "@/lib/auth/can-read-student";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

const paramsSchema = z.object({
  studentId: z.string().uuid(),
});

/**
 * GET /api/attendance/[studentId] — list a student's attendance records.
 * RLS-enforced: student reads own; teacher reads own sessions' students;
 * admin reads all. The path param is scoped by RLS regardless of input.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await params;
  const parsedParams = paramsSchema.safeParse({ studentId });
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid path parameters", details: parsedParams.error.format() }, { status: 400 });
  }
  const { searchParams } = new URL(request.url);
  const result = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!result.success) {
    return NextResponse.json({ error: "Invalid query parameters", details: result.error.format() }, { status: 400 });
  }

  if (!(await canReadStudent(supabase, user.id, parsedParams.data.studentId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { limit, cursor } = result.data;
  let q = supabase
    .from("attendance_records")
    .select("id, booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at, created_at, updated_at")
    .eq("student_id", parsedParams.data.studentId)
    .order("finalized_at", { ascending: false, nullsFirst: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("id", cursor);

  try {
    const { data, error } = await q;
    if (error) throw error;
    const hasMore = (data?.length ?? 0) > limit;
    const rows = hasMore ? data!.slice(0, limit) : data ?? [];
    return NextResponse.json({
      records: rows,
      nextCursor: hasMore ? rows[rows.length - 1]?.id : null,
    });
  } catch (err) {
    logError("api/attendance/list: failed", err, {
      tag: "attendance",
      user_id: user.id,
      student_id: parsedParams.data.studentId,
    });
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 });
  }
}

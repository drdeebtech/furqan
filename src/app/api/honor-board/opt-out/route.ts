import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setOptOut } from "@/lib/domains/honor-board/opt-out";

const BodySchema = z.object({
  studentId: z.string().uuid().optional(),
  optedOut: z.boolean(),
});

/**
 * PATCH /api/honor-board/opt-out
 *
 * Body: { studentId?: string; optedOut: boolean }
 *
 * - If studentId is omitted, applies to the caller's own profile.
 * - A guardian may supply their child's studentId (validated server-side
 *   via guardian_children — never trust the input for identity).
 * - 403 if the caller is neither the student nor a linked guardian.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 422 });
  }

  const { studentId, optedOut } = parsed.data;
  const targetStudentId = studentId ?? user.id;

  const result = await setOptOut(targetStudentId, optedOut, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, studentId: targetStudentId, optedOut });
}

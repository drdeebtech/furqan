import { NextResponse } from "next/server";
import { z } from "zod";
import { createNote, getNotesForStudent } from "@/lib/domains/reports/notes";
import { requireRole } from "@/lib/auth/require-admin";

const NoteBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

interface RouteParams {
  params: Promise<{ studentId: string }>;
}

/**
 * GET /api/reports/[studentId]/notes
 *
 * RLS scopes reads to the caller's permissions (teacher, student,
 * linked guardian, admin). The domain helper uses the session client for
 * user-facing reads, so no extra auth branching is needed here beyond a
 * basic session check in downstream helpers.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { studentId } = await params;
  const notes = await getNotesForStudent(studentId, { admin: false });
  return NextResponse.json({ studentId, notes });
}

/**
 * POST /api/reports/[studentId]/notes
 *
 * Teacher-only. The domain helper enforces the spec 020 assignment check
 * (subscription_teacher_assignments.is_active = true) before writing.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { studentId } = await params;
  let teacherId: string;
  try {
    const session = await requireRole("teacher");
    teacherId = session.id;
  } catch {
    return NextResponse.json({ error: "forbidden: teacher role required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = NoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const result = await createNote(studentId, teacherId, parsed.data.content);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 500 },
    );
  }
  return NextResponse.json({ note: result.note }, { status: 201 });
}

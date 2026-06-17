import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { listAvailableSpecialists } from "@/lib/domains/single-sessions/specialist-matching";

export const maxDuration = 30;

const Query = z.object({
  specialty: z.string().trim().min(1).max(80),
});

/**
 * GET /api/single-sessions/assessment-specialists?specialty=hifz
 *
 * Spec 022 US1: returns teachers whose specialties include the requested
 * specialty (FR-012). Auth required — a student browses the pool before
 * booking an assessment. The actual booking flow runs fail-before-charge
 * matching again at checkout time (R-004), so a specialist listed here may
 * no longer be available at booking time.
 *
 * Identity from the session only (FR-005); the route returns the SAME pool
 * to every authenticated student — no per-student gating.
 */
export async function GET(request: Request) {
  let authed: { id: string };
  try {
    authed = await requireRole("student");
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Only students may view specialists" }, { status: 403 });
    }
    throw e;
  }
  void authed; // identity enforced; no per-student filtering needed here.

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    specialty: url.searchParams.get("specialty") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = await listAvailableSpecialists(parsed.data.specialty);

  return NextResponse.json({
    success: true,
    data: data.map((t) => ({
      teacherId: t.teacherId,
      displayName: t.displayName,
      specialties: t.specialties,
      hasAvailability: t.hasAvailability,
    })),
  });
}

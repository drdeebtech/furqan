import { NextResponse } from "next/server";
import { z } from "zod";
import { getHalaqaRoster } from "@/lib/domains/scheduling/cohorts";
import { requireAdminUser } from "../../_adminAuth";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  classOfferingId: z.string().uuid(),
});

/**
 * GET /api/scheduling/admin/halaqa-roster — fetch halaqa roster.
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

  const { classOfferingId } = result.data;

  try {
    const roster = await getHalaqaRoster(admin, classOfferingId);
    return NextResponse.json(roster);
  } catch (err: any) {
    if (err.message === "Halaqa not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logError("api/scheduling/admin/halaqa-roster: failed", err, {});
    return NextResponse.json({ error: "Failed to fetch halaqa roster" }, { status: 500 });
  }
}

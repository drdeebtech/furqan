import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRoleForApi } from "@/lib/auth/require-admin";
import { getPayouts } from "@/lib/domains/attendance/payroll";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  teacherId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  status: z.enum(["pending", "paid", "failed"]).optional(),
});

/**
 * GET /api/payroll/payouts — list payouts (RLS-enforced).
 * Teachers see only their own; admins can filter by teacherId.
 * The role gate is defense-in-depth on top of RLS: students/guardians get an
 * explicit 403 instead of a probing-friendly empty 200.
 */
export async function GET(request: Request) {
  const g = await requireRoleForApi(["teacher", "admin"]);
  if (g instanceof NextResponse) return g;
  const userId = g.id;

  const { searchParams } = new URL(request.url);
  const result = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!result.success) {
    return NextResponse.json({ error: "Invalid query parameters", details: result.error.format() }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const payouts = await getPayouts(supabase, result.data);
    return NextResponse.json({ payouts });
  } catch (err) {
    logError("api/payroll/payouts: failed", err, {
      tag: "payroll",
      user_id: userId,
    });
    return NextResponse.json({ error: "Failed to fetch payouts" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

  try {
    const payouts = await getPayouts(supabase, result.data);
    return NextResponse.json({ payouts });
  } catch (err) {
    logError("api/payroll/payouts: failed", err, {
      tag: "payroll",
      user_id: user.id,
    });
    return NextResponse.json({ error: "Failed to fetch payouts" }, { status: 500 });
  }
}

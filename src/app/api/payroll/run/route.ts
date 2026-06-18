import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminUser } from "@/app/api/scheduling/_adminAuth";
import { runMonthlyPayroll } from "@/lib/domains/attendance/payroll";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "Expected YYYY-MM-01 (first of month)"),
});

/**
 * POST /api/payroll/run — run monthly payroll for a closed month.
 * Admin/service-role only. Surfaces FR-029 (non-uniform rate) and FR-030
 * (missing/zero rate) exceptions in the response so ops can act on them.
 */
export async function POST(request: Request) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) return auth.response;
  const { userId } = auth.value;

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

  const { month } = result.data;
  // Refuse future months — payroll runs on closed periods only.
  const monthStart = new Date(`${month}T00:00:00Z`);
  if (monthStart.getTime() > Date.now()) {
    return NextResponse.json({ error: "Cannot run payroll for a future month" }, { status: 422 });
  }

  try {
    const adminClient = createAdminClient();
    const payrollResult = await runMonthlyPayroll(adminClient, month);
    return NextResponse.json(payrollResult, { status: 200 });
  } catch (err) {
    logError("api/payroll/run: failed", err, {
      tag: "payroll",
      admin_id: userId,
      month,
    });
    return NextResponse.json({ error: "Failed to run payroll" }, { status: 500 });
  }
}

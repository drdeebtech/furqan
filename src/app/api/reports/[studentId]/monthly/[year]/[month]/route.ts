import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ParamsSchema = z.object({
  studentId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

interface RouteParams {
  params: Promise<{ studentId: string; year: string; month: string }>;
}

/**
 * GET /api/reports/[studentId]/monthly/[year]/[month]
 *
 * Returns the canonical latest (MAX version) monthly report for the
 * student+period, or `{ report: null }` when no report exists. RLS scopes
 * reads to the student, their linked guardian, or admin.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const rawParams = await params;
  const parsed = ParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid path params", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { studentId, year, month } = parsed.data;
  const supabase = await createClient();

  const { data: report, error } = await supabase
    .from("monthly_reports")
    .select("id, student_id, subscription_id, period_year, period_month, version, level_assessment_summary, generated_at, created_at")
    .eq("student_id", studentId)
    .eq("period_year", year)
    .eq("period_month", month)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<{
      id: string;
      student_id: string;
      subscription_id: string | null;
      period_year: number;
      period_month: number;
      version: number;
      level_assessment_summary: string | null;
      generated_at: string;
      created_at: string;
    } | null>();

  if (error) {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  return NextResponse.json({ studentId, year, month, report });
}

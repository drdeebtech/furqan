import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ParamsSchema = z.object({
  studentId: z.string().uuid(),
});

const QuerySchema = z.object({
  type: z.enum(["appreciation_juz", "appreciation_level", "course_completion"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

interface RouteParams {
  params: Promise<{ studentId: string }>;
}

/**
 * GET /api/certificates/[studentId]?type=…&limit=…
 *
 * Display-safe certificate read. RLS scopes to the student themselves, their
 * linked guardian, or admin. Response includes only display-safe fields
 * (`id`, `certificate_type`, `milestone_key`, `cited_range_start/end`,
 * `issued_at`) — no PII.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const url = new URL(request.url);
  const rawParams = await params;
  const paramsParsed = ParamsSchema.safeParse(rawParams);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { error: "invalid studentId", issues: paramsParsed.error.flatten() },
      { status: 422 },
    );
  }
  const queryParsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!queryParsed.success) {
    return NextResponse.json(
      { error: "invalid query", issues: queryParsed.error.flatten() },
      { status: 422 },
    );
  }

  const { studentId } = paramsParsed.data;
  const { type, limit } = queryParsed.data;
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  type CertRow = {
    id: string;
    certificate_type: "appreciation_juz" | "appreciation_level" | "course_completion";
    milestone_key: string;
    cited_range_start: string;
    cited_range_end: string;
    issued_at: string;
  };

  let query = supabase
    .from("certificates")
    .select("id, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at")
    .eq("student_id", studentId)
    .order("issued_at", { ascending: false })
    .limit(limit);
  if (type) {
    query = query.eq("certificate_type", type);
  }

  const { data: certificates, error } = await query.returns<CertRow[]>();
  if (error) {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  return NextResponse.json({ studentId, certificates: certificates ?? [] });
}

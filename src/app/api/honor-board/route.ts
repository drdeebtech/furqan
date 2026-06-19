import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

const QuerySchema = z.object({
  period: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type HonorBoardEntry = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  achievement_metric: number | null;
  rank_period: string;
  computed_at: string | null;
};

/**
 * GET /api/honor-board?period=YYYY-MM-DD&limit=20
 *
 * Public read — no auth required. Returns display-safe fields only (T025 / SC-008):
 * id, display_name, avatar_url, achievement_metric, rank_period, computed_at.
 * student_id and all contact fields are excluded.
 * Opted-out entries (is_opted_out=true) are always excluded at the DB level.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { period, limit } = parsed.data;

  const admin = createAdminClient();

  let query = admin
    .from("honor_board_entries")
    .select("id, display_name, avatar_url, achievement_metric, rank_period, computed_at")
    .eq("is_opted_out", false)
    .order("achievement_metric", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (period) {
    query = query.eq("rank_period", period);
  }

  const { data, error } = await query;

  if (error) {
    logError("honor-board GET: query failed", error, { tag: "honor-board" });
    return NextResponse.json({ error: "could not load honor board" }, { status: 500 });
  }

  return NextResponse.json({ data: (data as HonorBoardEntry[] | null) ?? [] });
}

import { NextResponse } from "next/server";
import { scoreAllStudents } from "@/lib/actions/retention";

/**
 * Daily retention scorer endpoint.
 * Invoked by an n8n cron workflow — requires X-N8N-Secret header.
 * Computes churn_risk_score for all active students and upserts to retention_signals.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("X-N8N-Secret");
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scoreAllStudents();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scoring failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

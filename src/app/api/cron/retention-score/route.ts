import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { scoreRetentionBatch } from "@/lib/actions/retention-batch";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Daily retention scorer endpoint.
 * Invoked by an n8n cron workflow — requires X-N8N-Secret header.
 * Computes churn_risk_score for all active students and upserts to retention_signals.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompare(secret, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scoreRetentionBatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scoring failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

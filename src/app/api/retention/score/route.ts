import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { scoreRetentionBatch } from "@/lib/actions/retention-batch";

export const maxDuration = 300;

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Retention scoring endpoint — delegates to scoreRetentionBatch() which is the
 * single source of truth also used by /api/cron/retention-score.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompare(secret, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scoreRetentionBatch();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scoring failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { clearPublicCache } from "@/lib/actions/cache";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Cron-triggered cache-clear endpoint.
 * Invoked every 30 minutes by Vercel Cron (configured in vercel.json).
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when
 * CRON_SECRET is set in env; we accept it OR the existing N8N_WEBHOOK_SECRET
 * header so n8n can also pull this trigger if needed.
 */
export async function GET(request: Request) {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
  const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await clearPublicCache("cron");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "cache clear failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

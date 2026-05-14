import { NextResponse } from "next/server";
import { clearPublicCache } from "@/lib/actions/cache";
import { safeCompareSecret } from "@/lib/security/secrets";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompareSecret(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

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

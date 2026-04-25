import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Daily retention sweep for auth events in audit_log.
 *
 * Privacy policy: educational data deleted within 90 days of account closure.
 * Login/logout events are educational metadata; mutation rows
 * (INSERT/UPDATE/DELETE) are EXEMPT and retained for compliance — financial
 * records require 7-year retention.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
 * Also accepts X-N8N-Secret so n8n can pull the trigger if needed.
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

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();

  try {
    const { count, error } = await admin
      .from("audit_log")
      .delete({ count: "exact" })
      .in("action", ["LOGIN", "LOGOUT"])
      .lt("created_at", cutoff);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      deleted: count ?? 0,
      cutoff,
      at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "audit cleanup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

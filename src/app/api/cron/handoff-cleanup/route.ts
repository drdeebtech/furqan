import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Daily prune of `remote_handoff_tokens`.
 *
 * Tokens have a 5-minute TTL (set in the table default + the migration's
 * partial cleanup index), so a daily sweep is plenty — there's no security
 * cost to a token row sitting around past `expires_at` because
 * `consumeHandoff` already filters by `gt('expires_at', now())` before
 * claiming, and the unique index on `code_hash` prevents any collision.
 *
 * Trigger: n8n (Mac mini) — schedule a workflow that GETs this endpoint
 * with `X-N8N-Secret: $N8N_WEBHOOK_SECRET`. Falls back to
 * `Authorization: Bearer $CRON_SECRET` for manual invocation. n8n is the
 * canonical trigger for furqan crons (per CLAUDE.md); Vercel Hobby caps
 * vercel.json crons at one-per-day and silently rejects builds with
 * sub-daily entries.
 */
export const GET = withCronMonitor("cron-handoff-cleanup", "0 3 * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
  const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();

  // Cast through `unknown` until generated types include remote_handoff_tokens
  // (the migration sits at supabase/migrations/20260503195950_*.sql).
  const tbl = (admin as unknown as { from: (t: string) => ReturnType<typeof admin.from> }).from(
    "remote_handoff_tokens",
  );
  const { count, error } = await tbl.delete({ count: "exact" }).lt("expires_at", cutoff);

  if (error) throw new Error(`handoff-cleanup: ${error.message}`);

  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    at: new Date().toISOString(),
  });
});

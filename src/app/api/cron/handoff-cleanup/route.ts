import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

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
export const GET = withAuthedCronMonitor("cron-handoff-cleanup", "0 3 * * *", async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();

  const { count, error } = await admin
    .from("remote_handoff_tokens")
    .delete({ count: "exact" })
    .lt("expires_at", cutoff);

  if (error) throw new Error(`handoff-cleanup: ${error.message}`);

  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    at: new Date().toISOString(),
  });
});

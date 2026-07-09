import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

/**
 * Daily expiry sweep for prepaid-hour wallets (spec 038, Phase 4 / FR-009).
 *
 * Voids the remaining hours on prepaid_hours lots whose rolling `expires_at`
 * has passed (status active → expired), appending one `expired` ledger event
 * per lot. The rolling window resets on every purchase or drawdown, so only
 * fully-dormant balances reach this sweep.
 *
 * The booking precondition already ignores `expires_at < now()` independently
 * (defense in depth, FR-008) — this sweep is the bookkeeping side that flips
 * status and records the void, not the enforcement of expiry.
 *
 * Idempotent: `sweep_expired_prepaid_hours()` only touches active+expired lots,
 * so a second run in the same day is a no-op (returns 0).
 *
 * Auth: `withAuthedCronMonitor` fail-closes on a missing/incorrect
 * `Authorization: Bearer ${CRON_SECRET}` (Vercel) or `X-N8N-Secret`
 * (n8n, the canonical furqan cron trigger per CLAUDE.md). The route never
 * runs unauthenticated — the sweep voids money-bearing hours, so it must
 * never be publicly triggerable.
 */
export const GET = withAuthedCronMonitor("cron-prepaid-hours-sweep", "0 3 * * *", async () => {
  // admin: cron — no user session; SECURITY DEFINER fn is service_role-only.
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("sweep_expired_prepaid_hours");

  if (error) {
    // Throw so Sentry's monitor marks the run as failed.
    throw new Error(`prepaid-hours-sweep: ${error.message}`);
  }

  return NextResponse.json({
    ok: true,
    lots_expired: data ?? 0,
    at: new Date().toISOString(),
  });
});

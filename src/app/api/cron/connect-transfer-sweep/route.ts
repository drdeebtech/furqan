import { NextResponse } from "next/server";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";
import { runTransferSweep } from "@/lib/domains/connect/transfer-sweep";
import { createConnectSweepStore } from "@/lib/domains/connect/transfer-sweep-store";

export const dynamic = "force-dynamic";

/**
 * Spec 040 Phase 1.2 / Phase 4 — the Stripe Connect transfer sweep trigger.
 *
 * Instantiates the real Postgres-backed SweepStore + the server-only Stripe
 * client and runs one idempotent `runTransferSweep`. The sweep leases eligible
 * `pending` earning entries (14-day hold, cutover partition, payouts_enabled on
 * the Stripe rail, no active hold), nets each against the teacher's outstanding
 * debt, and settles via Stripe transfer / manual queue / debt-recovery.
 *
 * DORMANT — a no-op in production until `connect_cutover_date` is set (empty by
 * default, spec FR-021): `claimEligibleEntries` returns ZERO rows while the
 * cutover is unset, so this route claims nothing and no Stripe call is made.
 * That is exactly why wiring the trigger now is safe.
 *
 * Auth: the canonical dual cron pattern via `withAuthedCronMonitor` — fail-
 * closed on a missing/incorrect `Authorization: Bearer ${CRON_SECRET}` (Vercel)
 * or `X-N8N-Secret` (n8n, the canonical furqan cron trigger per CLAUDE.md). It
 * moves money, so it must never be publicly triggerable.
 *
 * Schedule: NOT wired here. Registering the schedule (Vercel cron / n8n) is an
 * owner-gated go-live step, done alongside setting the cutover date. Suggested
 * cadence once live: every 15 min (matches the 15-min lease TTL).
 */
export const GET = withAuthedCronMonitor(
  "cron-connect-transfer-sweep",
  "*/15 * * * *",
  async () => {
    const store = createConnectSweepStore();
    const stripe = getStripe();

    const result = await runTransferSweep({
      store,
      stripe,
      logError,
    });

    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  },
);

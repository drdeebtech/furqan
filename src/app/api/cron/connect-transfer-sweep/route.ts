import { after, NextResponse } from "next/server";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";
import { runTransferSweep } from "@/lib/domains/connect/transfer-sweep";
import { createConnectSweepStore } from "@/lib/domains/connect/transfer-sweep-store";
import { emitEvent } from "@/lib/automation/emit";
import { MIXPANEL_EVENTS, trackMixpanel } from "@/lib/mixpanel-server";

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
 * cadence once live: every 15 min (the 30-min lease TTL gives 2× headroom, so
 * a slow run's leases are not deterministically stolen by the next run).
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
      // Best-effort typed events (plan Phase 1 item 6): n8n/analytics via
      // FurqanEvent + server-side Mixpanel. A sink failure is logged by the
      // sweep's safeEmit and never affects settlement (Principle III).
      // emitEvent is cheap on the request path (its network work is already
      // inside after()); trackMixpanel is NOT — its 2s timeout would serialize
      // into the money loop, so it runs via after() per its own contract
      // (review finding). error_detail is truncated: describeError's
      // JSON.stringify fallback for non-Error throws could otherwise forward
      // a fuller object than intended to n8n (security review P3).
      emitPayoutEvent: async (event) => {
        if (event.type === "payout.transfer_created") {
          await emitEvent("payout.transfer_created", "earning_entry", event.entryId, {
            teacher_id: event.teacherId,
            transfer_cents: event.transferCents,
            recovered_cents: event.recoveredCents,
            stripe_transfer_id: event.stripeTransferId,
          });
          after(() =>
            trackMixpanel(event.teacherId, MIXPANEL_EVENTS.PAYOUT_TRANSFER_CREATED, {
              transfer_cents: event.transferCents,
            }),
          );
          return;
        }
        await emitEvent("payout.transfer_failed", "earning_entry", event.entryId, {
          teacher_id: event.teacherId,
          error_detail: event.errorDetail.slice(0, 500),
        });
        after(() => trackMixpanel(event.teacherId, MIXPANEL_EVENTS.PAYOUT_TRANSFER_FAILED, {}));
      },
    });

    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  },
);

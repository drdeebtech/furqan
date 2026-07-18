// Spec 040 — shared transfer-sweep wiring (Phase 4 extraction).
//
// One place instantiates the Postgres SweepStore + server Stripe client and
// maps the sweep's typed events to FurqanEvent/Mixpanel, so the cron trigger
// and the admin manual trigger (/api/admin/payouts/sweep) cannot drift.
// The sweep itself stays idempotent and dormant until `connect_cutover_date`
// is armed (FR-021) — both triggers are safe no-ops before then.

import { after } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";
import { runTransferSweep, type PayoutSweepEvent } from "./transfer-sweep";
import { createConnectSweepStore } from "./transfer-sweep-store";
import { emitEvent } from "@/lib/automation/emit";
import { MIXPANEL_EVENTS, trackMixpanel } from "@/lib/mixpanel-server";

/**
 * Best-effort typed events (plan Phase 1 item 6): n8n/analytics via
 * FurqanEvent + server-side Mixpanel. A sink failure is logged by the sweep's
 * safeEmit and never affects settlement (Principle III). emitEvent is cheap on
 * the request path (its network work is already inside after()); trackMixpanel
 * is NOT — its 2s timeout would serialize into the money loop, so it runs via
 * after() per its own contract (review finding). error_detail is truncated:
 * describeError's JSON.stringify fallback for non-Error throws could otherwise
 * forward a fuller object than intended to n8n (security review P3).
 */
export async function emitPayoutSweepEvent(event: PayoutSweepEvent): Promise<void> {
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
}

/** Run one idempotent sweep with the real store/Stripe/event wiring. */
export async function runConnectTransferSweepOnce(): Promise<
  Awaited<ReturnType<typeof runTransferSweep>>
> {
  const store = createConnectSweepStore();
  const stripe = getStripe();
  return runTransferSweep({
    store,
    stripe,
    logError,
    emitPayoutEvent: emitPayoutSweepEvent,
  });
}

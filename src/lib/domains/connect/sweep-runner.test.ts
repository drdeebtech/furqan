import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn() }));
vi.mock("./transfer-sweep-store", () => ({ createConnectSweepStore: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/mixpanel-server", () => ({
  MIXPANEL_EVENTS: {
    PAYOUT_TRANSFER_CREATED: "payout_transfer_created",
    PAYOUT_TRANSFER_FAILED: "payout_transfer_failed",
  },
  trackMixpanel: vi.fn(async () => undefined),
}));

import { emitEvent } from "@/lib/automation/emit";
import { trackMixpanel } from "@/lib/mixpanel-server";
import { emitPayoutSweepEvent } from "./sweep-runner";

// Closes the tracked "cron route emit-mapping unit test" gap: the mapping now
// lives here, shared by the cron route AND the admin manual trigger.
describe("emitPayoutSweepEvent", () => {
  it("maps payout.transfer_created to the typed event + Mixpanel", async () => {
    await emitPayoutSweepEvent({
      type: "payout.transfer_created",
      entryId: "e1",
      teacherId: "t1",
      transferCents: 4_000,
      recoveredCents: 1_000,
      stripeTransferId: "tr_1",
    });

    expect(emitEvent).toHaveBeenCalledWith("payout.transfer_created", "earning_entry", "e1", {
      teacher_id: "t1",
      transfer_cents: 4_000,
      recovered_cents: 1_000,
      stripe_transfer_id: "tr_1",
    });
    expect(trackMixpanel).toHaveBeenCalledWith("t1", "payout_transfer_created", {
      transfer_cents: 4_000,
    });
  });

  it("maps payout.transfer_failed and TRUNCATES error_detail to 500 chars", async () => {
    vi.mocked(emitEvent).mockClear();
    await emitPayoutSweepEvent({
      type: "payout.transfer_failed",
      entryId: "e2",
      teacherId: "t1",
      errorDetail: "x".repeat(900),
    });

    expect(emitEvent).toHaveBeenCalledWith("payout.transfer_failed", "earning_entry", "e2", {
      teacher_id: "t1",
      error_detail: "x".repeat(500),
    });
    expect(trackMixpanel).toHaveBeenCalledWith("t1", "payout_transfer_failed", {});
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Self-contained: mirrors the mock surface of webhook-handlers.test.ts so this
// slice-3 behavior (teacher notification + calendar invite on paid instant
// confirm) can be asserted in isolation.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/automation/effects", () => ({ dispatchEffects: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/domains/billing/subscriptions", () => ({ upsertMirror: vi.fn() }));
vi.mock("@/lib/domains/billing/orchestrate", () => ({
  grantCycle: vi.fn(),
  buildCycleKey: vi.fn().mockReturnValue("k"),
}));
vi.mock("@/lib/domains/billing/events", () => ({
  BillingEvents: { Activated: "", Renewed: "", Canceled: "", PastDue: "" },
}));
vi.mock("@/lib/domains/catalog/credit-grant", () => ({
  resolvePendingTierChange: vi.fn().mockResolvedValue({ ok: true, pending: null }),
  finalizePendingTierChange: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/posthog-server", () => ({ getPostHogClient: () => ({ capture: vi.fn() }) }));

import { handlePaymentIntentSucceeded } from "../webhook-handlers";
import { emitEvent } from "@/lib/automation/emit";
import { dispatchEffects } from "@/lib/automation/effects";

type MockAdmin = { from: ReturnType<typeof vi.fn>; rpc?: ReturnType<typeof vi.fn> };

function makeEventCtx(admin: MockAdmin, eventData: Record<string, unknown>) {
  return {
    admin: admin as never,
    stripe: {} as never,
    event: { id: "evt_test", created: 1_700_000_000, data: { object: eventData } } as never,
    billingEventId: "evt-1",
  };
}

function makeHappyInstantAdmin(): { admin: MockAdmin; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockResolvedValue({ data: "booking-1", error: null });
  const from = vi.fn((table: string) => {
    if (table === "payments") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "pay-1" }, error: null }),
          })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      };
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    };
  });
  return { admin: { from, rpc }, rpc };
}

beforeEach(() => vi.clearAllMocks());

describe("handlePaymentIntentSucceeded — instant notifications (spec 022 slice 3)", () => {
  it("emits booking.created and dispatches the teacher effect after a paid instant booking", async () => {
    const { admin } = makeHappyInstantAdmin();
    const ctx = makeEventCtx(admin, {
      id: "pi_n1",
      currency: "usd",
      amount_received: 700,
      metadata: {
        booking_type: "instant",
        student_id: "stu-1",
        teacher_id: "t-1",
        scheduled_at: "2026-08-01T09:00:00.000Z",
      },
    });

    await handlePaymentIntentSucceeded(ctx);

    expect(emitEvent).toHaveBeenCalledWith(
      "booking.created",
      "booking",
      "booking-1",
      expect.objectContaining({ student_id: "stu-1", teacher_id: "t-1" }),
    );
    expect(dispatchEffects).toHaveBeenCalledWith(
      "booking.created",
      expect.objectContaining({ teacherId: "t-1", entityId: "booking-1" }),
    );
  });

  it("still finalizes the booking (does not throw) when a notification side-effect rejects", async () => {
    const { admin } = makeHappyInstantAdmin();
    vi.mocked(emitEvent).mockRejectedValueOnce(new Error("n8n down"));
    const ctx = makeEventCtx(admin, {
      id: "pi_n2",
      currency: "usd",
      amount_received: 700,
      metadata: {
        booking_type: "instant",
        student_id: "stu-1",
        teacher_id: "t-1",
        scheduled_at: "2026-08-01T09:00:00.000Z",
      },
    });

    // Best-effort side effects must never fail the money path (principle 15).
    await expect(handlePaymentIntentSucceeded(ctx)).resolves.toBeUndefined();
  });
});

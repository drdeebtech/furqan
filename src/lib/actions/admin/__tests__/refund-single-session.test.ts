import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const refundsCreate = vi.fn();
const single = vi.fn().mockResolvedValue({
  data: { stripe_payment_intent: "pi_1" },
  error: null,
});
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ refunds: { create: refundsCreate } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { approveSingleSessionRefund } from "../refund-single-session";

beforeEach(() => {
  rpc.mockReset();
  refundsCreate.mockReset();
});

describe("approveSingleSessionRefund", () => {
  it("reserves, issues a full-charge Stripe refund, returns ok", async () => {
    rpc.mockResolvedValueOnce({ data: 20, error: null }); // reserve → amount
    refundsCreate.mockResolvedValueOnce({ id: "re_1" });
    const res = await approveSingleSessionRefund({
      bookingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toMatchObject({ ok: true, amountUsd: 20 });
    // reserve called with (booking, requestId)
    expect(rpc).toHaveBeenCalledWith(
      "reserve_single_session_refund",
      expect.objectContaining({
        p_booking: "11111111-1111-4111-8111-111111111111",
      }),
    );
    // Stripe: NO amount, frozen PI, correct metadata + idempotencyKey
    const [body, opts] = refundsCreate.mock.calls[0];
    expect(body.amount).toBeUndefined();
    expect(body.payment_intent).toBe("pi_1");
    expect(body.metadata).toMatchObject({ refund_kind: "single_session" });
    expect(opts.idempotencyKey).toBe(body.metadata.refund_request_id);
  });

  it("releases the reservation when the Stripe refund fails", async () => {
    rpc.mockResolvedValueOnce({ data: 20, error: null }); // reserve
    refundsCreate.mockRejectedValueOnce(new Error("card_error"));
    rpc.mockResolvedValueOnce({ data: null, error: null }); // release
    const res = await approveSingleSessionRefund({
      bookingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toMatchObject({ ok: false });
    expect(rpc).toHaveBeenCalledWith("release_single_session_refund", expect.any(Object));
  });

  it("surfaces a reserve guard error (e.g. PayPal / wrong status) without calling Stripe", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not refundable" } });
    const res = await approveSingleSessionRefund({
      bookingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toMatchObject({ ok: false, error: "not refundable" });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const res = await approveSingleSessionRefund({ bookingId: "not-a-uuid" });
    expect(res).toMatchObject({ ok: false, error: "invalid input" });
  });
});

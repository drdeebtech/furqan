import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (the action resolves these internally) ────────────────────
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const requireAdmin = vi.fn().mockResolvedValue({ id: "admin-1" });
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: () => requireAdmin() }));

const refundsCreate = vi.fn();
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => ({ refunds: { create: refundsCreate } }) }));

let mockAdmin: MockAdmin;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mockAdmin }));

import { approvePrepaidRefund } from "../refund-prepaid-hours";

// ─── Mock admin builder ─────────────────────────────────────────────────────
type Lot = { id: string; stripe_payment_intent_id: string | null; rate_paid_usd: number } | null;

interface MockAdmin {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

function makeAdmin(opts: {
  lot?: Lot;
  lotError?: { message: string } | null;
  reserveAmount?: number | null;
  reserveError?: { message: string } | null;
  releaseError?: { message: string } | null;
} = {}): MockAdmin {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.lot === undefined
      ? { id: "lot-1", stripe_payment_intent_id: "pi_123", rate_paid_usd: 10 }
      : opts.lot,
    error: opts.lotError ?? null,
  });
  // .select(...).eq("id", …).eq("product_type", …).maybeSingle()
  const eqInner = vi.fn(() => ({ maybeSingle }));
  const eqOuter = vi.fn(() => ({ eq: eqInner }));
  const select = vi.fn(() => ({ eq: eqOuter }));

  const rpc = vi.fn((name: string) => {
    if (name === "reserve_prepaid_refund") {
      return Promise.resolve({
        data: opts.reserveAmount === undefined ? 20 : opts.reserveAmount,
        error: opts.reserveError ?? null,
      });
    }
    if (name === "release_prepaid_refund") {
      return Promise.resolve({ data: null, error: opts.releaseError ?? null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return { from: vi.fn(() => ({ select })), rpc };
}

const LOT_ID = "00000000-0000-1000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin-1" });
  refundsCreate.mockResolvedValue({ id: "re_123" });
});

describe("approvePrepaidRefund", () => {
  it("rejects invalid input (non-uuid lot / non-positive hours) before any money op", async () => {
    mockAdmin = makeAdmin();
    expect(await approvePrepaidRefund({ lotId: "not-a-uuid", hours: 1 })).toEqual({
      ok: false, error: "invalid input",
    });
    expect(await approvePrepaidRefund({ lotId: LOT_ID, hours: 0 })).toEqual({
      ok: false, error: "invalid input",
    });
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("rejects a PayPal lot (null stripe_payment_intent_id) BEFORE reserving/voiding", async () => {
    mockAdmin = makeAdmin({ lot: { id: "lot-1", stripe_payment_intent_id: null, rate_paid_usd: 10 } });
    const res = await approvePrepaidRefund({ lotId: LOT_ID, hours: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("PayPal");
    // guarded up front — no void, no Stripe call
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("rejects when the lot is not found / not a prepaid lot", async () => {
    mockAdmin = makeAdmin({ lot: null });
    const res = await approvePrepaidRefund({ lotId: LOT_ID, hours: 2 });
    expect(res.ok).toBe(false);
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
  });

  it("happy path: reserve → Stripe refund with idempotencyKey + metadata; webhook owns finalize", async () => {
    mockAdmin = makeAdmin({ reserveAmount: 20 });
    const res = await approvePrepaidRefund({ lotId: LOT_ID, hours: 2 });

    expect(res).toEqual({ ok: true, amountUsd: 20, refundRequestId: expect.any(String) });
    // reserve was called with the lot + hours + a request id
    expect(mockAdmin.rpc).toHaveBeenCalledWith(
      "reserve_prepaid_refund",
      expect.objectContaining({ p_lot: LOT_ID, p_hours: 2 }),
    );
    // Stripe refund: correct PI, cents, metadata, and the idempotencyKey option
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    const [body, options] = refundsCreate.mock.calls[0];
    expect(body).toMatchObject({ payment_intent: "pi_123", amount: 2000 });
    expect(body.metadata.refund_request_id).toEqual(options.idempotencyKey);
    // finalize is the webhook's job — release must NOT be called on success
    expect(mockAdmin.rpc).not.toHaveBeenCalledWith("release_prepaid_refund", expect.anything());
  });

  it("Stripe failure → release_prepaid_refund restores the hours, returns error", async () => {
    mockAdmin = makeAdmin({ reserveAmount: 20 });
    refundsCreate.mockRejectedValue(new Error("card_declined"));

    const res = await approvePrepaidRefund({ lotId: LOT_ID, hours: 2 });
    expect(res).toEqual({ ok: false, error: "card_declined" });
    expect(mockAdmin.rpc).toHaveBeenCalledWith(
      "release_prepaid_refund",
      expect.objectContaining({ p_refund_request_id: expect.any(String) }),
    );
  });

  it("returns the reserve error without calling Stripe when reserve fails", async () => {
    mockAdmin = makeAdmin({ reserveAmount: null, reserveError: { message: "over-refund" } });
    const res = await approvePrepaidRefund({ lotId: LOT_ID, hours: 99 });
    expect(res).toEqual({ ok: false, error: "over-refund" });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("propagates when requireAdmin rejects (non-admin)", async () => {
    mockAdmin = makeAdmin();
    requireAdmin.mockRejectedValue(new Error("forbidden"));
    await expect(approvePrepaidRefund({ lotId: LOT_ID, hours: 2 })).rejects.toThrow("forbidden");
  });
});

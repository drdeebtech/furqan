import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { grantCycle } from "../orchestrate";

/**
 * Spec 018 / T018 — grantCycle error paths and param forwarding.
 *
 * The happy-path replay-classification tests live in grant-idempotency.test.ts.
 * These tests cover the failure branches and verify the RPC is called with the
 * correct params.
 */

const grantInput = {
  subscriptionId: "sub-uuid",
  studentId: "stu-uuid",
  planId: "plan-uuid",
  cycleKey: "in_1:sub_1:2026-06-01",
  stripePaymentIntent: "pi_1",
  amountCents: 4000,
  creditCount: 8,
  expiresAt: "2026-07-01T00:00:00.000Z",
  sessionMetadata: {} as Record<string, unknown>,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdmin(opts: {
  priorGrantId: string | null;
  rpcData: string | null;
  rpcError: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcData, error: opts.rpcError });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.priorGrantId ? { id: opts.priorGrantId } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, rpc };
}

// ── grantCycle: error paths ───────────────────────────────────────────────────

describe("grantCycle — error paths", () => {
  it("returns ok:false when RPC returns an error", async () => {
    const admin = makeAdmin({ priorGrantId: null, rpcData: null, rpcError: { message: "rpc boom" } });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: false, error: "rpc boom" });
  });

  it("returns ok:false when RPC returns no id (null data)", async () => {
    const admin = makeAdmin({ priorGrantId: null, rpcData: null, rpcError: null });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: false, error: "grant_subscription_cycle returned no id" });
  });

  it("returns ok:false when RPC throws (crash path)", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockRejectedValue(new Error("network crash"));
    const admin = { from, rpc };
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: false, error: "network crash" });
  });

  it("returns ok:false with generic message when non-Error is thrown", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockRejectedValue("string error");
    const admin = { from, rpc };
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: false, error: "grant crashed" });
  });
});

// ── grantCycle: correct params forwarded to RPC ───────────────────────────────

describe("grantCycle — param forwarding", () => {
  it("calls grant_subscription_cycle with all required params", async () => {
    const admin = makeAdmin({ priorGrantId: null, rpcData: "grant-xyz", rpcError: null });
    await grantCycle(admin as never, grantInput);

    expect(admin.rpc).toHaveBeenCalledWith("grant_subscription_cycle", {
      p_subscription_id: grantInput.subscriptionId,
      p_student_id: grantInput.studentId,
      p_plan_id: grantInput.planId,
      p_cycle_key: grantInput.cycleKey,
      p_stripe_payment_intent: grantInput.stripePaymentIntent,
      p_amount_cents: grantInput.amountCents,
      p_credit_count: grantInput.creditCount,
      p_expires_at: grantInput.expiresAt,
      p_session_metadata: grantInput.sessionMetadata,
    });
  });

  it("returns ok:true with grantId on success (new grant)", async () => {
    const admin = makeAdmin({ priorGrantId: null, rpcData: "grant-new", rpcError: null });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: true, grantId: "grant-new", created: true });
  });

  it("returns ok:true with grantId on success (replay — created:false)", async () => {
    const admin = makeAdmin({ priorGrantId: "grant-existing", rpcData: "grant-existing", rpcError: null });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: true, grantId: "grant-existing", created: false });
  });
});

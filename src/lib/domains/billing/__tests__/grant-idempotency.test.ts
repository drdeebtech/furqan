import { describe, it, expect, vi } from "vitest";

// server-only is a runtime guard; no-op it so the domain modules import under vitest
// (same pattern as require-admin.test.ts).
vi.mock("server-only", () => ({}));

import { buildCycleKey, grantCycle } from "../orchestrate";
import { shouldApplyEvent, toSubscriptionStatus } from "../subscriptions";

/**
 * Spec 018 / T018 — grant idempotency, additive renewal, and recency guard.
 *
 * The atomic money logic (grant_subscription_cycle SQL fn) is verified against
 * local Postgres in T014 (all 7 assertions PASS). These tests cover the TS
 * decision layer that the webhook handler relies on:
 *   • `buildCycleKey`      — per-cycle idempotency key (same cycle → same key,
 *                            new cycle → distinct key ⇒ additive).
 *   • `grantCycle`          — replay classification (existing cycle_key ⇒ no-op;
 *                            absent ⇒ new grant).
 *   • `shouldApplyEvent`    — recency guard (stale out-of-order delivery rejected).
 */

// ── buildCycleKey: idempotency + additive semantics ─────────────────────────

describe("buildCycleKey (idempotency + additive renewal)", () => {
  const base = {
    invoiceId: "in_abc",
    subscriptionId: "sub_xyz",
    periodStartIso: "2026-06-01T00:00:00.000Z",
  };

  it("returns the SAME key for the same cycle (idempotent replay)", () => {
    expect(buildCycleKey(base)).toBe(buildCycleKey({ ...base }));
  });

  it("returns a DISTINCT key for a new period (additive renewal)", () => {
    const cycle1 = buildCycleKey(base);
    const cycle2 = buildCycleKey({ ...base, periodStartIso: "2026-07-01T00:00:00.000Z" });
    expect(cycle1).not.toBe(cycle2);
  });

  it("returns a DISTINCT key for a new invoice (replay vs new not conflated)", () => {
    const a = buildCycleKey(base);
    const b = buildCycleKey({ ...base, invoiceId: "in_def" });
    expect(a).not.toBe(b);
  });

  it("strips ':' ambiguity so the key is reversible/unambiguous", () => {
    // A ':' inside an id is replaced so it can't spoof extra segments.
    const key = buildCycleKey({
      invoiceId: "in:a",
      subscriptionId: "sub:b",
      periodStartIso: "2026-06-01",
    });
    const parts = key.split(":");
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => !p.includes(":"))).toBe(true);
  });
});

// ── grantCycle: replay classification (mocked admin) ────────────────────────

/**
 * Minimal mock of the service-role client. `grantCycle` performs exactly two
 * calls: a `student_packages` lookup (cycle_key exists?) then `rpc`. We model
 * both so we can assert the created/no-op classification.
 */
function makeMockAdmin(opts: { priorGrantId: string | null; rpcGrantId: string }) {
  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcGrantId, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.priorGrantId ? { id: opts.priorGrantId } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => (table === "student_packages" ? { select } : {}));
  return { from, rpc };
}

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

describe("grantCycle (replay classification)", () => {
  it("marks a NEW grant when no prior cycle_key exists", async () => {
    const admin = makeMockAdmin({ priorGrantId: null, rpcGrantId: "grant-1" });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: true, grantId: "grant-1", created: true });
    expect(admin.rpc).toHaveBeenCalledWith("grant_subscription_cycle", expect.objectContaining({
      p_cycle_key: grantInput.cycleKey,
    }));
  });

  it("marks a NO-OP replay when the cycle_key already exists (idempotent)", async () => {
    const admin = makeMockAdmin({ priorGrantId: "grant-1", rpcGrantId: "grant-1" });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: true, grantId: "grant-1", created: false });
  });

  it("returns failure when the RPC errors", async () => {
    const admin = makeMockAdmin({ priorGrantId: null, rpcGrantId: "grant-1" });
    admin.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } as never });
    const res = await grantCycle(admin as never, grantInput);
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

// ── shouldApplyEvent: recency guard (R5) ────────────────────────────────────

describe("shouldApplyEvent (recency guard)", () => {
  it("applies an event newer than the last applied", () => {
    expect(shouldApplyEvent(2_000, 1_000)).toBe(true);
  });

  it("applies an event equal to the last applied (>=, dedup-safe)", () => {
    expect(shouldApplyEvent(1_000, 1_000)).toBe(true);
  });

  it("REJECTS a stale event older than the last applied", () => {
    // out-of-order delivery: a stale `active` after `deleted` must not regress.
    expect(shouldApplyEvent(1_000, 2_000)).toBe(false);
  });

  it("keeps the mirror canceled when a stale active follows a deleted", () => {
    // Concrete R5 scenario: deleted landed at t=2000, stale active at t=1000.
    const deletedAtMs = 2_000;
    const staleActiveAtMs = 1_000;
    expect(shouldApplyEvent(staleActiveAtMs, deletedAtMs)).toBe(false);
  });

  it("treats an uninitialized mirror (epoch=0) as applying any event", () => {
    expect(shouldApplyEvent(1, 0)).toBe(true);
  });
});

// ── toSubscriptionStatus: mapping (defensive) ───────────────────────────────

describe("toSubscriptionStatus", () => {
  it("maps known Stripe statuses", () => {
    expect(toSubscriptionStatus("active")).toBe("active");
    expect(toSubscriptionStatus("past_due")).toBe("past_due");
    expect(toSubscriptionStatus("canceled")).toBe("canceled");
    expect(toSubscriptionStatus("unpaid")).toBe("unpaid");
  });

  it("defaults an unrecognized status to incomplete (fail safe)", () => {
    expect(toSubscriptionStatus("weird")).toBe("incomplete");
    expect(toSubscriptionStatus("")).toBe("incomplete");
  });
});

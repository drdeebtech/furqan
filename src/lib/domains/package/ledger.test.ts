import { describe, it, expect, vi } from "vitest";

/**
 * Tests for the Package ledger facade (architecture deepening #1).
 *
 * The facade's value is that the "check data, not just error" debit rule
 * (Spec 005 FR-002) and the soonest-expiry selection live in ONE place instead
 * of copy-pasted across three call sites. The interface is the test surface:
 * a fake admin client lets us assert every DebitOutcome branch without a DB.
 */

vi.mock("server-only", () => ({}));
const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));

import { selectActivePackage, debitPackage } from "./ledger";

// Minimal fake of the admin client's fluent query builder for selectActivePackage.
function fakeSelectClient(result: { data: unknown; error?: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

function fakeRpcClient(result: { data?: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc: vi.fn().mockResolvedValue(result) } as any;
}

describe("selectActivePackage", () => {
  it("returns the mapped active package when one exists", async () => {
    const admin = fakeSelectClient({ data: { id: "pkg-1", sessions_remaining: 3 } });
    expect(await selectActivePackage(admin, "student-1")).toEqual({
      id: "pkg-1",
      sessionsRemaining: 3,
    });
  });

  it("fails closed AND logs when the query errors (No Silent Failures)", async () => {
    mockLogError.mockClear();
    const admin = fakeSelectClient({ data: null, error: { message: "db down" } });
    expect(await selectActivePackage(admin, "student-1")).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      "selectActivePackage query failed",
      expect.objectContaining({ message: "db down" }),
      expect.objectContaining({ tag: "package-ledger" }),
    );
  });

  it("returns null when the student has no active package with credit", async () => {
    const admin = fakeSelectClient({ data: null });
    expect(await selectActivePackage(admin, "student-1")).toBeNull();
  });

  // ── Fix #6: past-due booking gate ──────────────────────────────────────────
  it("BLOCKS a subscription grant whose subscription is past_due", async () => {
    const admin = fakeSelectClient({
      data: { id: "sub-pkg", sessions_remaining: 4, subscription_id: "sub-1", subscriptions: { status: "past_due" } },
    });
    expect(await selectActivePackage(admin, "student-1")).toBeNull();
  });

  it("allows a subscription grant whose subscription is active", async () => {
    const admin = fakeSelectClient({
      data: { id: "sub-pkg", sessions_remaining: 4, subscription_id: "sub-1", subscriptions: { status: "active" } },
    });
    expect(await selectActivePackage(admin, "student-1")).toEqual({ id: "sub-pkg", sessionsRemaining: 4 });
  });

  it("NEVER blocks a prepaid/single-session lot (no subscription_id)", async () => {
    const admin = fakeSelectClient({
      data: { id: "wallet-lot", sessions_remaining: 2, subscription_id: null, subscriptions: null },
    });
    expect(await selectActivePackage(admin, "student-1")).toEqual({ id: "wallet-lot", sessionsRemaining: 2 });
  });

  it("handles a PostgREST array-shaped embed defensively (still blocks past_due)", async () => {
    const admin = fakeSelectClient({
      data: { id: "sub-pkg", sessions_remaining: 4, subscription_id: "sub-1", subscriptions: [{ status: "unpaid" }] },
    });
    expect(await selectActivePackage(admin, "student-1")).toBeNull();
  });
});

describe("debitPackage", () => {
  it("ok when the kernel reports a row was charged", async () => {
    const admin = fakeRpcClient({ data: true });
    expect(await debitPackage(admin, "pkg-1")).toEqual({ ok: true });
    expect(admin.rpc).toHaveBeenCalledWith("deduct_package_session", { p_package_id: "pkg-1" });
  });

  it("exhausted when the kernel returns null (predicate failed, not an error)", async () => {
    // The Spec 005 FR-002 trap: no error, but data !== true means nothing was charged.
    const admin = fakeRpcClient({ data: null });
    expect(await debitPackage(admin, "pkg-1")).toEqual({ ok: false, reason: "exhausted" });
  });

  it("error when the RPC itself fails", async () => {
    const admin = fakeRpcClient({ error: { message: "boom" } });
    expect(await debitPackage(admin, "pkg-1")).toEqual({
      ok: false,
      reason: "error",
      message: "boom",
    });
  });
});

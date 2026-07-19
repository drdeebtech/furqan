import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  grantHifzCycleCredits,
  resolvePendingTierChange,
  finalizePendingTierChange,
} from "./credit-grant";

// ─── Mock builders ──────────────────────────────────────────────────────────

/** Build a mock admin with configurable RPC + query responses. */
function mockAdmin(opts: {
  priorGrant?: { id: string } | null;
  rpcResult?: string | null;
  rpcError?: { message: string } | null;
  pendingChange?: Record<string, unknown> | null;
  pendingLookupError?: { message: string } | null;
  pendingUpdateError?: { message: string } | null;
  targetPackage?: { subscription_plan_id: string | null } | null;
  subUpdateError?: { message: string } | null;
}) {
  const rpc = vi.fn(async () => {
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    return { data: opts.rpcResult !== undefined ? opts.rpcResult : "grant-new-id", error: null };
  });

  const maybeSinglePrior = vi.fn(async () => ({
    data: opts.priorGrant ?? null,
    error: null,
  }));

  const maybeSinglePending = vi.fn(async () => ({
    data: opts.pendingChange ?? null,
    error: opts.pendingLookupError ?? null,
  }));

  const maybeSinglePkg = vi.fn(async () => ({
    data: opts.targetPackage ?? null,
    error: null,
  }));

  const pendingUpdateEq = vi.fn(async () => ({
    error: opts.pendingUpdateError ?? null,
  }));
  const pendingUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: pendingUpdateEq })),
  }));

  const subUpdateEq = vi.fn(() => ({
    select: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({
        data: opts.subUpdateError ? null : { id: "sub-1" },
        error: opts.subUpdateError ?? null,
      })),
    })),
  }));
  const subUpdate = vi.fn(() => ({ eq: subUpdateEq }));

  // The `from` method dispatches based on the table name.
  const from = vi.fn((table: string) => {
    if (table === "student_packages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: maybeSinglePrior })),
          })),
        })),
      };
    }
    if (table === "pending_tier_changes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: maybeSinglePending })) })),
        })),
        update: pendingUpdate,
      };
    }
    if (table === "packages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: maybeSinglePkg })),
        })),
      };
    }
    if (table === "subscriptions") {
      return {
        update: subUpdate,
      };
    }
    return {};
  });

  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── grantHifzCycleCredits ──────────────────────────────────────────────────

describe("grantHifzCycleCredits", () => {
  it("returns ok=true with grantId on success", async () => {
    const admin = mockAdmin({ rpcResult: "grant-123" });
    const result = await grantHifzCycleCredits(admin, "sub-1", "plan-1", "key-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantId).toBe("grant-123");
      expect(result.created).toBe(true);
    }
  });

  it("returns created=false when grant already existed (idempotency)", async () => {
    const admin = mockAdmin({
      priorGrant: { id: "existing-grant" },
      rpcResult: "existing-grant",
    });
    const result = await grantHifzCycleCredits(admin, "sub-1", "plan-1", "key-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantId).toBe("existing-grant");
      expect(result.created).toBe(false);
    }
  });

  it("returns ok=false on RPC error", async () => {
    const admin = mockAdmin({
      rpcError: { message: "function not found" },
    });
    const result = await grantHifzCycleCredits(admin, "sub-1", "plan-1", "key-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("function not found");
    }
  });

  it("returns ok=false when RPC returns null", async () => {
    const admin = mockAdmin({ rpcResult: null });
    const result = await grantHifzCycleCredits(admin, "sub-1", "plan-1", "key-1");
    expect(result.ok).toBe(false);
  });
});

// ─── resolvePendingTierChange ───────────────────────────────────────────────

describe("resolvePendingTierChange", () => {
  it("returns pending=null when no pending change exists (common case)", async () => {
    const admin = mockAdmin({ pendingChange: null });
    const result = await resolvePendingTierChange(admin, "sub-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pending).toBeNull();
  });

  it("returns ok=false on lookup query error", async () => {
    const admin = mockAdmin({ pendingLookupError: { message: "connection lost" } });
    const result = await resolvePendingTierChange(admin, "sub-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("connection lost");
  });

  it("resolves a pending change to its new plan id (read-only, no grant)", async () => {
    const admin = mockAdmin({
      pendingChange: {
        id: "ptc-1",
        subscription_id: "sub-1",
        student_id: "stu-1",
        from_package_id: "pkg-old",
        to_package_id: "pkg-new",
        change_reason: "type_change",
        status: "pending",
      },
      targetPackage: { subscription_plan_id: "plan-new-tier" },
    });
    const rpc = (admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    const result = await resolvePendingTierChange(admin, "sub-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pending).toEqual({ pendingId: "ptc-1", newPlanId: "plan-new-tier" });
    }
    // Read-only: resolution must never issue a credit-grant RPC.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns ok=false when to_package has no subscription_plan_id", async () => {
    const admin = mockAdmin({
      pendingChange: {
        id: "ptc-1",
        subscription_id: "sub-1",
        student_id: "stu-1",
        from_package_id: "pkg-old",
        to_package_id: "pkg-new",
        change_reason: "type_change",
        status: "pending",
      },
      targetPackage: { subscription_plan_id: null },
    });
    const result = await resolvePendingTierChange(admin, "sub-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no subscription_plan_id");
  });
});

// ─── finalizePendingTierChange ──────────────────────────────────────────────

describe("finalizePendingTierChange", () => {
  it("switches the subscription plan + marks pending applied, issuing NO grant", async () => {
    const admin = mockAdmin({});
    const rpc = (admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    const result = await finalizePendingTierChange(admin, "sub-1", "ptc-1", "plan-new");
    expect(result.ok).toBe(true);
    // The single cycle grant already ran via grantCycle; finalize must not
    // grant again — this is the double-grant regression guard.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns ok=false when the subscription plan switch fails", async () => {
    const admin = mockAdmin({ subUpdateError: { message: "write failed" } });
    const result = await finalizePendingTierChange(admin, "sub-1", "ptc-1", "plan-new");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("write failed");
  });

  it("returns ok=false when the status transition errors", async () => {
    const admin = mockAdmin({ pendingUpdateError: { message: "RLS blocked" } });
    const result = await finalizePendingTierChange(admin, "sub-1", "ptc-1", "plan-new");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("RLS blocked");
  });
});

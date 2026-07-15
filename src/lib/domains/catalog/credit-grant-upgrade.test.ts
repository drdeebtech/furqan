import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  recordPendingUpgradeGrant,
  applyImmediateUpgradeGrant,
} from "./credit-grant";

/**
 * Payment-gated immediate-upgrade grant (audit 2026-07-15).
 *
 * Contract under test: the delta credits for an immediate tier upgrade are
 * granted ONLY by applyImmediateUpgradeGrant (invoked from invoice.paid for
 * billing_reason=subscription_update), never at request time. Payment failure
 * simply never invokes it — rows stay 'pending' and no credits exist.
 */

type Res = { data: unknown; error: unknown };
const OK: Res = { data: null, error: null };

/** Thenable chain: any method returns the chain; awaiting resolves `res`. */
function chain(res: Res): unknown {
  const c: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: Res) => unknown) => resolve(res);
        if (typeof prop === "symbol") return undefined;
        return () => c;
      },
    },
  );
  return c;
}

/**
 * Mock admin: per-table results keyed by first chained op. `select` accepts a
 * queue (array) consumed per call — applyImmediateUpgradeGrant selects
 * pending_upgrade_grants twice (by-invoice, then by-subscription fallback).
 * `ops` records "<table>.<op>" so tests can assert what was (not) touched.
 */
function makeAdmin(cfg: {
  rpc?: Res;
  tables?: Record<string, { select?: Res[] | Res; insert?: Res; update?: Res }>;
}) {
  const ops: string[] = [];
  const rpc = vi.fn(async () => cfg.rpc ?? { data: "grant-id-1", error: null });
  const from = vi.fn((table: string) => {
    const t = cfg.tables?.[table] ?? {};
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop !== "select" && prop !== "insert" && prop !== "update") return undefined;
          return (..._args: unknown[]) => {
            ops.push(`${table}.${String(prop)}`);
            if (prop === "select") {
              const s = t.select;
              const res = Array.isArray(s) ? (s.shift() ?? OK) : (s ?? OK);
              return chain(res);
            }
            return chain((prop === "insert" ? t.insert : t.update) ?? OK);
          };
        },
      },
    );
  });
  return { admin: { from, rpc } as never, rpc, ops };
}

const PENDING_ROW = {
  id: "pug-1",
  subscription_id: "sub-1",
  student_id: "stu-1",
  plan_id: "plan-2",
  delta_sessions: 4,
  stripe_invoice_id: "in_upgrade_1",
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── recordPendingUpgradeGrant ───────────────────────────────────────────────

describe("recordPendingUpgradeGrant", () => {
  const ARGS = {
    subscriptionId: "sub-1",
    studentId: "stu-1",
    planId: "plan-2",
    deltaSessions: 4,
    stripeInvoiceId: "in_upgrade_1",
  };

  it("records the pending row and does NOT grant any credits", async () => {
    const { admin, rpc, ops } = makeAdmin({
      tables: { pending_upgrade_grants: { insert: { data: { id: "pug-1" }, error: null } } },
    });
    const result = await recordPendingUpgradeGrant(admin, ARGS);
    expect(result).toEqual({ ok: true, id: "pug-1" });
    // The defining property of the fix: recording must never touch the grant
    // RPC or student_packages — credits exist only after invoice.paid.
    expect(rpc).not.toHaveBeenCalled();
    expect(ops.filter((o) => o.startsWith("student_packages"))).toEqual([]);
  });

  it("is idempotent on the invoice UNIQUE: duplicate re-reads the winner", async () => {
    const { admin, rpc } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          insert: { data: null, error: { code: "23505", message: "duplicate key" } },
          select: { data: { id: "pug-winner" }, error: null },
        },
      },
    });
    const result = await recordPendingUpgradeGrant(admin, ARGS);
    expect(result).toEqual({ ok: true, id: "pug-winner" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on any other insert error", async () => {
    const { admin } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          insert: { data: null, error: { code: "42P01", message: "relation missing" } },
        },
      },
    });
    const result = await recordPendingUpgradeGrant(admin, ARGS);
    expect(result.ok).toBe(false);
  });
});

// ─── applyImmediateUpgradeGrant ──────────────────────────────────────────────

describe("applyImmediateUpgradeGrant", () => {
  it("grants the delta with the invoice-scoped key and marks the row applied", async () => {
    const { admin, rpc, ops } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          select: [{ data: PENDING_ROW, error: null }],
          update: OK,
        },
        student_packages: { select: { data: null, error: null } },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_upgrade_1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pendingId).toBe("pug-1");
      expect(result.deltaSessions).toBe(4);
      expect(result.studentId).toBe("stu-1");
    }
    expect(rpc).toHaveBeenCalledWith("grant_hifz_cycle_credits", {
      p_subscription_id: "sub-1",
      p_plan_id: "plan-2",
      p_billing_cycle_key: "upgrade_in_upgrade_1",
      p_session_count: 4,
    });
    expect(ops).toContain("pending_upgrade_grants.update");
  });

  it("returns no_pending (and grants NOTHING) when no row matches — unpaid/foreign invoices", async () => {
    const { admin, rpc, ops } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          select: [
            { data: null, error: null }, // by invoice id
            { data: null, error: null }, // by subscription fallback
          ],
        },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_other");
    expect(result).toEqual({ ok: false, reason: "no_pending" });
    expect(rpc).not.toHaveBeenCalled();
    expect(ops).not.toContain("pending_upgrade_grants.update");
  });

  it("falls back to the subscription's newest pending row when the invoice id doesn't match (synthetic-key path)", async () => {
    const { admin, rpc } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          select: [
            { data: null, error: null },
            { data: PENDING_ROW, error: null },
          ],
          update: OK,
        },
        student_packages: { select: { data: null, error: null } },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_real_from_stripe");
    expect(result.ok).toBe(true);
    // Grant key uses the REAL invoice id from the webhook, keeping retries idempotent.
    expect(rpc).toHaveBeenCalledWith(
      "grant_hifz_cycle_credits",
      expect.objectContaining({ p_billing_cycle_key: "upgrade_in_real_from_stripe" }),
    );
  });

  it("refuses to grant when the pending row belongs to a different subscription", async () => {
    const { admin, rpc } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          select: [{ data: { ...PENDING_ROW, subscription_id: "sub-OTHER" }, error: null }],
        },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_upgrade_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("lookup_failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does NOT mark the row applied when the grant RPC fails (retry-safe)", async () => {
    const { admin, ops } = makeAdmin({
      rpc: { data: null, error: { message: "rpc down" } },
      tables: {
        pending_upgrade_grants: {
          select: [{ data: PENDING_ROW, error: null }],
        },
        student_packages: { select: { data: null, error: null } },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_upgrade_1");
    expect(result).toEqual({ ok: false, reason: "update_failed", error: "rpc down" });
    // Row stays 'pending' so the webhook retry can re-attempt the grant.
    expect(ops).not.toContain("pending_upgrade_grants.update");
  });

  it("fails closed when the pending lookup errors", async () => {
    const { admin, rpc } = makeAdmin({
      tables: {
        pending_upgrade_grants: {
          select: [{ data: null, error: { message: "db down" } }],
        },
      },
    });
    const result = await applyImmediateUpgradeGrant(admin, "sub-1", "in_upgrade_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("lookup_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

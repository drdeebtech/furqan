import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async (): Promise<{ id: string }> => ({ id: "99999999-9999-4999-8999-999999999999" })),
}));
vi.mock("@/lib/auth/require-admin", () => {
  class ForbiddenError extends Error {}
  class UnauthenticatedError extends Error {}
  return { ForbiddenError, UnauthenticatedError, requireAdmin: () => requireAdmin() };
});
import { ForbiddenError } from "@/lib/auth/require-admin";

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const rpcResults = new Map<string, { data: unknown; error: { message: string } | null }>();
vi.mock("@/lib/supabase/rpc", () => ({
  callRpc: vi.fn(async (_c: unknown, name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return rpcResults.get(name) ?? { data: null, error: null };
  }),
}));

const settleMock = vi.fn(async () => true);
vi.mock("@/lib/domains/connect/manual-settlement-store", () => ({
  createConnectManualSettlementStore: () => ({ settleManualDue: settleMock }),
}));

import {
  exportManualDueCsv,
  liftPayoutHold,
  placePayoutHold,
  setPayoutMethod,
  settleManualDueEntry,
} from "./payouts";

const T = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResults.clear();
  requireAdmin.mockClear();
  requireAdmin.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" });
  settleMock.mockClear();
  settleMock.mockResolvedValue(true);
});

describe("admin payout actions — auth + input boundaries", () => {
  it("every action refuses a non-admin session before touching the DB", async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError("no"));
    const results = await Promise.all([
      placePayoutHold({ teacherId: T, reason: "x" }),
      liftPayoutHold({ holdId: H }),
      setPayoutMethod({ teacherId: T, method: "manual" }),
      settleManualDueEntry({ entryId: E, referenceId: "r" }),
      exportManualDueCsv(),
    ]);
    for (const r of results) {
      expect(r).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(rpcCalls).toHaveLength(0);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("rejects malformed input before the RPC", async () => {
    expect(await placePayoutHold({ teacherId: "not-a-uuid", reason: "x" })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await placePayoutHold({ teacherId: T, reason: "   " })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("admin payout actions — behavior", () => {
  it("placePayoutHold stamps the SESSION admin as creator", async () => {
    rpcResults.set("connect_admin_place_hold", { data: H, error: null });
    const res = await placePayoutHold({ teacherId: T, reason: "fraud check" });
    expect(res.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      name: "connect_admin_place_hold",
      args: { p_teacher_id: T, p_reason: "fraud check", p_actor: "99999999-9999-4999-8999-999999999999" },
    });
  });

  it("liftPayoutHold surfaces not_found for an already-released hold", async () => {
    rpcResults.set("connect_admin_lift_hold", { data: "not_found", error: null });
    expect(await liftPayoutHold({ holdId: H })).toEqual({ ok: false, error: "not_found" });
    rpcResults.set("connect_admin_lift_hold", { data: "lifted", error: null });
    expect((await liftPayoutHold({ holdId: H })).ok).toBe(true);
  });

  it("setPayoutMethod reports the stuck-manual_due re-route count", async () => {
    rpcResults.set("connect_admin_set_payout_method", {
      data: [{ outcome: "changed", rerouted_entries: 3 }],
      error: null,
    });
    const res = await setPayoutMethod({ teacherId: T, method: "stripe_connect" });
    expect(res).toEqual({ ok: true, note: "rerouted 3 stuck manual entries to the Stripe rail" });
  });

  it("settleManualDueEntry maps the fenced no-op to not_found (replay-safe)", async () => {
    settleMock.mockResolvedValue(false);
    expect(await settleManualDueEntry({ entryId: E, referenceId: "bank-42" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(settleMock).toHaveBeenCalledWith({
      entryId: E,
      referenceId: "bank-42",
      settlingAdmin: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("export builds CSV, escapes quotes, and REFUSES when the audit write fails", async () => {
    rpcResults.set("connect_admin_payouts_overview", {
      data: {
        cutover_date: "",
        teachers: [],
        manual_due: [
          {
            entry_id: E, teacher_id: T, full_name: 'A "Q" Teacher', amount_cents: 12345,
            session_delivery_id: null, delivered_at: null, created_at: "2026-07-01T00:00:00Z",
          },
        ],
      },
      error: null,
    });

    const ok = await exportManualDueCsv();
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.rows).toBe(1);
    expect(ok.csv).toContain('"A ""Q"" Teacher"');
    expect(ok.csv).toContain('"123.45"');
    expect(rpcCalls.map((c) => c.name)).toContain("connect_admin_log_export");

    rpcResults.set("connect_admin_log_export", { data: null, error: { message: "down" } });
    const refused = await exportManualDueCsv();
    expect(refused).toEqual({ ok: false, error: "unavailable" });
  });
});

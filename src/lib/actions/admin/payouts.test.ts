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

const settleMock = vi.fn(async (): Promise<Record<string, unknown>> => ({
  outcome: "settled",
  netPaidCents: 100,
  recoveredCents: 0,
}));
vi.mock("@/lib/domains/connect/manual-settlement-store", () => ({
  createConnectManualSettlementStore: () => ({ settleManualDue: settleMock }),
}));

import {
  exportManualDueCsv,
  liftPayoutHold,
  placePayoutHold,
  requeueFailedEntry,
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
  settleMock.mockResolvedValue({ outcome: "settled", netPaidCents: 100, recoveredCents: 0 });
});

describe("admin payout actions — auth + input boundaries", () => {
  it("every action refuses a non-admin session before touching the DB", async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError("no"));
    const results = await Promise.all([
      placePayoutHold({ teacherId: T, reason: "x" }),
      liftPayoutHold({ holdId: H }),
      setPayoutMethod({ teacherId: T, method: "manual" }),
      settleManualDueEntry({ entryId: E, referenceId: "r", expectedNetCents: 100 }),
      requeueFailedEntry({ entryId: E }),
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

  it("requeueFailedEntry stamps the SESSION admin and maps outcomes (FR-011)", async () => {
    rpcResults.set("connect_admin_requeue_failed_entry", { data: "requeued", error: null });
    expect((await requeueFailedEntry({ entryId: E })).ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      name: "connect_admin_requeue_failed_entry",
      args: { p_entry_id: E, p_actor: "99999999-9999-4999-8999-999999999999" },
    });
    rpcResults.set("connect_admin_requeue_failed_entry", { data: "not_found", error: null });
    expect(await requeueFailedEntry({ entryId: E })).toEqual({ ok: false, error: "not_found" });
  });

  it("settleManualDueEntry maps the fenced no-op to not_found (replay-safe)", async () => {
    settleMock.mockResolvedValue({ outcome: "not_found" });
    expect(
      await settleManualDueEntry({ entryId: E, referenceId: "bank-42", expectedNetCents: 700 }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(settleMock).toHaveBeenCalledWith({
      entryId: E,
      referenceId: "bank-42",
      settlingAdmin: "99999999-9999-4999-8999-999999999999",
      expectedNetCents: 700,
    });
  });

  it("settleManualDueEntry surfaces the net split when debt was netted (FR-027a)", async () => {
    settleMock.mockResolvedValue({ outcome: "settled", netPaidCents: 700, recoveredCents: 300 });
    expect(
      await settleManualDueEntry({ entryId: E, referenceId: "bank-42", expectedNetCents: 700 }),
    ).toEqual({ ok: true, note: "paid $7.00 net of $3.00 debt" });
  });

  it("settleManualDueEntry maps stale_net to a refusal carrying the fresh amount", async () => {
    settleMock.mockResolvedValue({ outcome: "stale_net", netDueCents: 450 });
    expect(
      await settleManualDueEntry({ entryId: E, referenceId: "bank-42", expectedNetCents: 700 }),
    ).toEqual({ ok: false, error: "stale_net", note: "net is now $4.50 — re-check and retry" });
  });

  it("settleManualDueEntry maps teacher_on_hold to its own refusal (FR-027a)", async () => {
    settleMock.mockResolvedValue({ outcome: "teacher_on_hold" });
    expect(
      await settleManualDueEntry({ entryId: E, referenceId: "bank-42", expectedNetCents: 700 }),
    ).toEqual({ ok: false, error: "teacher_on_hold" });
  });

  it("settleManualDueEntry accepts the zero-net close with NO reference", async () => {
    settleMock.mockResolvedValue({ outcome: "closed_debt_recovered", recoveredCents: 1000 });
    const res = await settleManualDueEntry({ entryId: E, expectedNetCents: 0 });
    expect(res.ok).toBe(true);
    expect(settleMock).toHaveBeenCalledWith({
      entryId: E,
      referenceId: null,
      settlingAdmin: "99999999-9999-4999-8999-999999999999",
      expectedNetCents: 0,
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
            net_due_cents: 12000, recovered_cents: 345,
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
    // FR-027a: the payable NET and the already-recovered explanation columns.
    expect(ok.csv).toContain("net_due_usd,already_recovered_usd");
    expect(ok.csv).toContain('"120.00"');
    expect(ok.csv).toContain('"3.45"');
    expect(rpcCalls.map((c) => c.name)).toContain("connect_admin_log_export");

    rpcResults.set("connect_admin_log_export", { data: null, error: { message: "down" } });
    const refused = await exportManualDueCsv();
    expect(refused).toEqual({ ok: false, error: "unavailable" });
  });

  it("export neutralizes spreadsheet formula cells (= and @ leading)", async () => {
    rpcResults.set("connect_admin_payouts_overview", {
      data: {
        cutover_date: "",
        teachers: [],
        manual_due: [
          { entry_id: E, teacher_id: T, full_name: '=HYPERLINK("http://evil")', amount_cents: 100,
            net_due_cents: 100, recovered_cents: 0,
            session_delivery_id: null, delivered_at: null, created_at: "2026-07-01T00:00:00Z" },
          { entry_id: H, teacher_id: T, full_name: "@cmd", amount_cents: 100,
            net_due_cents: 100, recovered_cents: 0,
            session_delivery_id: null, delivered_at: null, created_at: "2026-07-01T00:00:00Z" },
        ],
      },
      error: null,
    });

    const res = await exportManualDueCsv();
    if (!res.ok) throw new Error("expected ok");
    expect(res.csv).toContain("\"'=HYPERLINK");
    expect(res.csv).toContain("\"'@cmd\"");
    expect(res.csv).not.toContain('"=HYPERLINK');
  });

  it("a REJECTED rpc (transport crash) normalizes to unavailable, never throws", async () => {
    const { callRpc } = await import("@/lib/supabase/rpc");
    vi.mocked(callRpc).mockRejectedValueOnce(new Error("fetch failed"));
    expect(await placePayoutHold({ teacherId: T, reason: "x" })).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});

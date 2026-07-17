import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConnectManualSettlementStore } from "./manual-settlement-store";

// Stub the service-role admin client down to the ONE method callRpc uses:
// `.rpc(name, args)`. The test asserts the adapter maps settleManualDue to the
// right RPC name + arg shape and surfaces the boolean — the SQL itself is proven
// in scripts/walk-040-manual-settlement.sql, not here.
function makeAdmin(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => result);
  return { admin: { rpc } as never, rpc };
}

const INPUT = {
  entryId: "11111111-1111-4111-8111-111111111111",
  referenceId: "BANK-TXN-42",
  settlingAdmin: "22222222-2222-4222-a222-222222222222",
};

describe("ConnectManualSettlementStore — RPC mapping", () => {
  it("settleManualDue → connect_settle_manual_due with the p_-prefixed args, returns true", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const store = new ConnectManualSettlementStore(admin);

    const ok = await store.settleManualDue(INPUT);

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("connect_settle_manual_due", {
      p_entry_id: INPUT.entryId,
      p_reference_id: INPUT.referenceId,
      p_settling_admin: INPUT.settlingAdmin,
    });
  });

  it("a false result (replay / wrong status / stripe_connect refusal) maps straight through", async () => {
    const { admin } = makeAdmin({ data: false, error: null });
    const store = new ConnectManualSettlementStore(admin);
    expect(await store.settleManualDue(INPUT)).toBe(false);
  });

  it("an rpc error THROWS — a transport/DB error is never coerced to a silent false", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "connection reset", code: "57P01" } });
    const store = new ConnectManualSettlementStore(admin);
    await expect(store.settleManualDue(INPUT)).rejects.toThrow(/rpc failed/);
  });
});

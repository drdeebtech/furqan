import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConnectManualSettlementStore } from "./manual-settlement-store";

// Stub the service-role admin client down to the ONE method callRpc uses:
// `.rpc(name, args)`. The test asserts the adapter maps settleManualDue to the
// right RPC name + arg shape and parses the jsonb outcome — the SQL itself is
// proven in the rolled-back walks, not here.
function makeAdmin(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => result);
  return { admin: { rpc } as never, rpc };
}

const INPUT = {
  entryId: "11111111-1111-4111-8111-111111111111",
  referenceId: "BANK-TXN-42",
  settlingAdmin: "22222222-2222-4222-a222-222222222222",
  expectedNetCents: 700,
};

describe("ConnectManualSettlementStore — RPC mapping", () => {
  it("settleManualDue → connect_settle_manual_due with the p_-prefixed args incl. the net fence", async () => {
    const { admin, rpc } = makeAdmin({
      data: { outcome: "settled", net_paid_cents: 700, recovered_cents: 300 },
      error: null,
    });
    const store = new ConnectManualSettlementStore(admin);

    const out = await store.settleManualDue(INPUT);

    expect(out).toEqual({ outcome: "settled", netPaidCents: 700, recoveredCents: 300 });
    expect(rpc).toHaveBeenCalledWith("connect_settle_manual_due", {
      p_entry_id: INPUT.entryId,
      p_reference_id: INPUT.referenceId,
      p_settling_admin: INPUT.settlingAdmin,
      p_expected_net_cents: 700,
    });
  });

  it("passes a NULL reference for the zero-net close", async () => {
    const { admin, rpc } = makeAdmin({
      data: { outcome: "closed_debt_recovered", recovered_cents: 1000 },
      error: null,
    });
    const store = new ConnectManualSettlementStore(admin);
    const out = await store.settleManualDue({ ...INPUT, referenceId: null, expectedNetCents: 0 });
    expect(out).toEqual({ outcome: "closed_debt_recovered", recoveredCents: 1000 });
    expect(rpc).toHaveBeenCalledWith(
      "connect_settle_manual_due",
      expect.objectContaining({ p_reference_id: null, p_expected_net_cents: 0 }),
    );
  });

  it.each([
    [{ outcome: "stale_net", net_due_cents: 450 }, { outcome: "stale_net", netDueCents: 450 }],
    [{ outcome: "teacher_on_hold" }, { outcome: "teacher_on_hold" }],
    [{ outcome: "not_found" }, { outcome: "not_found" }],
  ])("maps the %j refusal to its typed outcome", async (raw, expected) => {
    const { admin } = makeAdmin({ data: raw, error: null });
    const store = new ConnectManualSettlementStore(admin);
    expect(await store.settleManualDue(INPUT)).toEqual(expected);
  });

  it("an rpc error THROWS — a transport/DB error is never coerced to a refusal", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "connection reset", code: "57P01" } });
    const store = new ConnectManualSettlementStore(admin);
    await expect(store.settleManualDue(INPUT)).rejects.toThrow(/rpc failed/);
  });

  it.each([true, false, null, { outcome: "??" }, { outcome: "settled" }])(
    "an unrecognized payload (%j) THROWS — never a guessed outcome on a money path",
    async (bad) => {
      const { admin } = makeAdmin({ data: bad, error: null });
      const store = new ConnectManualSettlementStore(admin);
      await expect(store.settleManualDue(INPUT)).rejects.toThrow(/unrecognized rpc outcome/);
    },
  );
});

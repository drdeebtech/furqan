import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PostgresConnectAccountsStore } from "./connect-accounts-store";

// Stub the service-role admin client down to the ONE method callRpc uses:
// `.rpc(name, args)`. These tests assert the adapter maps each store method to
// the right RPC name + arg shape and the error posture (throw, never silent) —
// the SQL itself is proven in the rolled-back walk for
// 20260803000000_connect_account_functions.sql, not here.
function makeAdmin(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => result);
  return { admin: { rpc } as never, rpc };
}

const TEACHER = "11111111-1111-4111-8111-111111111111";

describe("PostgresConnectAccountsStore — RPC mapping", () => {
  it("getByTeacherId → connect_get_account; maps the row and parses last_event_at", async () => {
    const { admin, rpc } = makeAdmin({
      data: [
        {
          teacher_id: TEACHER,
          stripe_account_id: "acct_1",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
          requirements: { currently_due: [] },
          last_event_at: "2026-07-17T10:00:00Z",
        },
      ],
      error: null,
    });
    const store = new PostgresConnectAccountsStore(admin);

    const row = await store.getByTeacherId(TEACHER);

    expect(rpc).toHaveBeenCalledWith("connect_get_account", { p_teacher_id: TEACHER });
    expect(row).toMatchObject({
      teacherId: TEACHER,
      stripeAccountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    expect(row?.lastEventAt).toEqual(new Date("2026-07-17T10:00:00Z"));
  });

  it("getByTeacherId returns null for an empty result (no row yet)", async () => {
    const { admin } = makeAdmin({ data: [], error: null });
    const store = new PostgresConnectAccountsStore(admin);
    expect(await store.getByTeacherId(TEACHER)).toBeNull();
  });

  it("linkAccount → connect_link_account with p_-prefixed args", async () => {
    const { admin, rpc } = makeAdmin({ data: null, error: null });
    const store = new PostgresConnectAccountsStore(admin);

    await store.linkAccount({ teacherId: TEACHER, stripeAccountId: "acct_1" });

    expect(rpc).toHaveBeenCalledWith("connect_link_account", {
      p_teacher_id: TEACHER,
      p_stripe_account_id: "acct_1",
    });
  });

  it("applyAccountStatus → connect_apply_account_status; maps each named outcome", async () => {
    for (const outcome of ["applied", "stale", "unknown_account"] as const) {
      const { admin, rpc } = makeAdmin({ data: outcome, error: null });
      const store = new PostgresConnectAccountsStore(admin);

      const result = await store.applyAccountStatus({
        stripeAccountId: "acct_1",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirements: null,
        eventAt: new Date("2026-07-17T10:00:00Z"),
      });

      expect(result).toBe(outcome);
      expect(rpc).toHaveBeenCalledWith("connect_apply_account_status", {
        p_stripe_account_id: "acct_1",
        p_charges_enabled: true,
        p_payouts_enabled: true,
        p_details_submitted: true,
        p_requirements: null,
        p_event_at: "2026-07-17T10:00:00.000Z",
      });
    }
  });

  it("applyAccountStatus throws on an unexpected outcome string (never silently mapped)", async () => {
    const { admin } = makeAdmin({ data: "banana", error: null });
    const store = new PostgresConnectAccountsStore(admin);
    await expect(
      store.applyAccountStatus({
        stripeAccountId: "acct_1",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirements: null,
        eventAt: new Date(),
      }),
    ).rejects.toThrow(/unexpected outcome/);
  });

  it("an rpc error THROWS on every method — never coerced to null/false/stale", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "connection reset", code: "57P01" } });
    const store = new PostgresConnectAccountsStore(admin);

    await expect(store.getByTeacherId(TEACHER)).rejects.toThrow(/rpc failed/);
    await expect(
      store.linkAccount({ teacherId: TEACHER, stripeAccountId: "acct_1" }),
    ).rejects.toThrow(/rpc failed/);
    await expect(
      store.applyAccountStatus({
        stripeAccountId: "acct_1",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirements: null,
        eventAt: new Date(),
      }),
    ).rejects.toThrow(/rpc failed/);
  });
});

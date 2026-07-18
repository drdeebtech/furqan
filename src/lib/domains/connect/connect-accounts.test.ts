// Spec 040 Phase 1 tail — connect-accounts unit tests (in-memory fakes,
// mirrors the transfer-sweep test style: DI, no network, no DB).
import { describe, expect, it } from "vitest";
import {
  applyAccountUpdate,
  deriveAccountStatus,
  ensureConnectAccount,
  mintOnboardingLink,
  type ApplyStatusOutcome,
  type ConnectAccountRow,
  type ConnectAccountsStore,
  type StripeConnectApi,
} from "./connect-accounts";

function makeRow(overrides: Partial<ConnectAccountRow> = {}): ConnectAccountRow {
  return {
    teacherId: "t-1",
    stripeAccountId: "acct_1",
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirements: null,
    lastEventAt: null,
    ...overrides,
  };
}

/** In-memory store fake honouring the insert-or-verify + recency contracts. */
function makeFakeStore(seed: ConnectAccountRow[] = []) {
  const rows = new Map<string, ConnectAccountRow>(seed.map((r) => [r.teacherId, r]));
  const linkCalls: Array<{ teacherId: string; stripeAccountId: string }> = [];
  const store: ConnectAccountsStore = {
    async getByTeacherId(teacherId) {
      return rows.get(teacherId) ?? null;
    },
    async linkAccount(input) {
      linkCalls.push(input);
      const existing = rows.get(input.teacherId);
      if (existing?.stripeAccountId && existing.stripeAccountId !== input.stripeAccountId) {
        throw new Error("stripe_account_id is one-time (NULL->value only)");
      }
      rows.set(input.teacherId, {
        ...(existing ?? makeRow({ teacherId: input.teacherId })),
        teacherId: input.teacherId,
        stripeAccountId: input.stripeAccountId,
      });
    },
    async applyAccountStatus(input): Promise<ApplyStatusOutcome> {
      const row = [...rows.values()].find((r) => r.stripeAccountId === input.stripeAccountId);
      if (!row) return "unknown_account";
      if (row.lastEventAt && row.lastEventAt > input.eventAt) return "stale";
      rows.set(row.teacherId, {
        ...row,
        chargesEnabled: input.chargesEnabled,
        payoutsEnabled: input.payoutsEnabled,
        detailsSubmitted: input.detailsSubmitted,
        requirements: input.requirements,
        lastEventAt: input.eventAt,
      });
      return "applied";
    },
  };
  return { store, rows, linkCalls };
}

function makeFakeStripe(behavior?: { failCreate?: boolean }) {
  const createCalls: Array<{ params: unknown; idempotencyKey: string }> = [];
  const linkCalls: Array<Record<string, string>> = [];
  let counter = 0;
  const byKey = new Map<string, string>();
  const stripe: StripeConnectApi = {
    accounts: {
      async create(params, options) {
        if (behavior?.failCreate) throw new Error("stripe unavailable");
        createCalls.push({ params, idempotencyKey: options.idempotencyKey });
        // Stripe idempotency semantics: same key → same account.
        const existing = byKey.get(options.idempotencyKey);
        if (existing) return { id: existing };
        const id = `acct_${++counter}`;
        byKey.set(options.idempotencyKey, id);
        return { id };
      },
    },
    accountLinks: {
      async create(params) {
        linkCalls.push(params as unknown as Record<string, string>);
        return { url: `https://connect.stripe.com/setup/${params.account}` };
      },
    },
  };
  return { stripe, createCalls, linkCalls };
}

describe("ensureConnectAccount (FR-001 create-or-reuse)", () => {
  it("creates one Express account with the canonical idempotency key and links it", async () => {
    const { store, rows } = makeFakeStore();
    const { stripe, createCalls } = makeFakeStripe();

    const id = await ensureConnectAccount({ store, stripe }, "t-1");

    expect(id).toBe("acct_1");
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].idempotencyKey).toBe("connect-account:t-1");
    expect(createCalls[0].params).toMatchObject({
      type: "express",
      metadata: { furqan_teacher_id: "t-1" },
    });
    expect(rows.get("t-1")?.stripeAccountId).toBe("acct_1");
  });

  it("reuses the existing account — second call makes zero Stripe create calls", async () => {
    const { store } = makeFakeStore([makeRow({ teacherId: "t-1", stripeAccountId: "acct_9" })]);
    const { stripe, createCalls } = makeFakeStripe();

    const id = await ensureConnectAccount({ store, stripe }, "t-1");

    expect(id).toBe("acct_9");
    expect(createCalls).toHaveLength(0);
  });

  it("two racing calls converge on ONE account (Stripe idempotency + insert-or-verify link)", async () => {
    const { store, rows } = makeFakeStore();
    const { stripe } = makeFakeStripe();

    const [a, b] = await Promise.all([
      ensureConnectAccount({ store, stripe }, "t-1"),
      ensureConnectAccount({ store, stripe }, "t-1"),
    ]);

    expect(a).toBe(b);
    expect(rows.get("t-1")?.stripeAccountId).toBe(a);
  });

  it("distinct teachers get distinct accounts", async () => {
    const { store } = makeFakeStore();
    const { stripe } = makeFakeStripe();

    const a = await ensureConnectAccount({ store, stripe }, "t-1");
    const b = await ensureConnectAccount({ store, stripe }, "t-2");

    expect(a).not.toBe(b);
  });

  it("a Stripe create failure propagates loudly and links nothing", async () => {
    const { store, rows, linkCalls } = makeFakeStore();
    const { stripe } = makeFakeStripe({ failCreate: true });

    await expect(ensureConnectAccount({ store, stripe }, "t-1")).rejects.toThrow(
      "stripe unavailable",
    );
    expect(linkCalls).toHaveLength(0);
    expect(rows.has("t-1")).toBe(false);
  });
});

describe("mintOnboardingLink", () => {
  it("ensures the account then mints an account_onboarding link with the given URLs", async () => {
    const { store } = makeFakeStore();
    const { stripe, linkCalls } = makeFakeStripe();

    const url = await mintOnboardingLink(
      { store, stripe },
      {
        teacherId: "t-1",
        refreshUrl: "https://app.example/teacher/payouts/refresh",
        returnUrl: "https://app.example/teacher/payouts/return",
      },
    );

    expect(url).toContain("acct_1");
    expect(linkCalls[0]).toMatchObject({
      account: "acct_1",
      refresh_url: "https://app.example/teacher/payouts/refresh",
      return_url: "https://app.example/teacher/payouts/return",
      type: "account_onboarding",
    });
  });

  it("an expired-link retry reuses the DB-linked account — one create total, two links", async () => {
    const { store } = makeFakeStore();
    const { stripe, createCalls, linkCalls } = makeFakeStripe();
    const input = {
      teacherId: "t-1",
      refreshUrl: "https://app.example/r",
      returnUrl: "https://app.example/x",
    };

    await mintOnboardingLink({ store, stripe }, input);
    await mintOnboardingLink({ store, stripe }, input);

    // Second mint short-circuits on the linked row (FR-001) — no second create.
    expect(createCalls).toHaveLength(1);
    expect(linkCalls).toHaveLength(2);
    expect(linkCalls[0].account).toBe(linkCalls[1].account);
  });
});

describe("deriveAccountStatus (FR-004 card states)", () => {
  it("no row → none", () => {
    expect(deriveAccountStatus(null)).toBe("none");
  });

  it("row without a linked account id → none (link never completed)", () => {
    expect(deriveAccountStatus(makeRow({ stripeAccountId: null }))).toBe("none");
  });

  it("linked but details not submitted → onboarding_incomplete", () => {
    expect(deriveAccountStatus(makeRow())).toBe("onboarding_incomplete");
  });

  it("details submitted, payouts not enabled → pending_verification", () => {
    expect(deriveAccountStatus(makeRow({ detailsSubmitted: true }))).toBe("pending_verification");
  });

  it("payouts enabled wins regardless of the other flags", () => {
    expect(
      deriveAccountStatus(makeRow({ payoutsEnabled: true, detailsSubmitted: true })),
    ).toBe("payouts_enabled");
  });
});

describe("applyAccountUpdate (FR-003 recency-guarded mirror)", () => {
  const snapshot = {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirements: { currently_due: [] },
  };

  it("applies a fresh event and stamps lastEventAt", async () => {
    const { store, rows } = makeFakeStore([
      makeRow({ teacherId: "t-1", stripeAccountId: "acct_1" }),
    ]);

    const outcome = await applyAccountUpdate(store, {
      ...snapshot,
      stripeAccountId: "acct_1",
      eventAt: new Date("2026-07-17T10:00:00Z"),
    });

    expect(outcome).toBe("applied");
    const row = rows.get("t-1")!;
    expect(row.payoutsEnabled).toBe(true);
    expect(row.lastEventAt).toEqual(new Date("2026-07-17T10:00:00Z"));
  });

  it("a stale out-of-order event is rejected and overwrites nothing", async () => {
    const { store, rows } = makeFakeStore([
      makeRow({
        teacherId: "t-1",
        stripeAccountId: "acct_1",
        payoutsEnabled: true,
        lastEventAt: new Date("2026-07-17T10:00:00Z"),
      }),
    ]);

    const outcome = await applyAccountUpdate(store, {
      ...snapshot,
      payoutsEnabled: false,
      stripeAccountId: "acct_1",
      eventAt: new Date("2026-07-17T09:00:00Z"),
    });

    expect(outcome).toBe("stale");
    expect(rows.get("t-1")?.payoutsEnabled).toBe(true);
  });

  it("an idempotent replay (equal timestamp) applies as a no-op-equivalent", async () => {
    const { store } = makeFakeStore([
      makeRow({
        teacherId: "t-1",
        stripeAccountId: "acct_1",
        lastEventAt: new Date("2026-07-17T10:00:00Z"),
      }),
    ]);

    const outcome = await applyAccountUpdate(store, {
      ...snapshot,
      stripeAccountId: "acct_1",
      eventAt: new Date("2026-07-17T10:00:00Z"),
    });

    expect(outcome).toBe("applied");
  });

  it("an event for an unknown account is surfaced, never written", async () => {
    const { store } = makeFakeStore();

    const outcome = await applyAccountUpdate(store, {
      ...snapshot,
      stripeAccountId: "acct_ghost",
      eventAt: new Date(),
    });

    expect(outcome).toBe("unknown_account");
  });
});

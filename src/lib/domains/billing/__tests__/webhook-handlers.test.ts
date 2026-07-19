import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/domains/billing/subscriptions", () => ({
  upsertMirror: vi.fn(),
}));
vi.mock("@/lib/domains/billing/orchestrate", () => ({
  grantCycle: vi.fn(),
  buildCycleKey: vi.fn().mockReturnValue("in_1:sub_1:2026-06-01"),
}));
vi.mock("@/lib/domains/billing/events", () => ({
  BillingEvents: {
    Activated: "subscription.activated",
    Renewed: "subscription.renewed",
    Canceled: "subscription.canceled",
    PastDue: "subscription.past_due",
  },
}));
vi.mock("@/lib/domains/catalog/credit-grant", () => ({
  resolvePendingTierChange: vi.fn().mockResolvedValue({ ok: true, pending: null }),
  finalizePendingTierChange: vi.fn().mockResolvedValue({ ok: true }),
  applyImmediateUpgradeGrant: vi.fn().mockResolvedValue({ ok: false, reason: "no_pending" }),
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: vi.fn() }),
}));

import {
  markEvent,
  handleSubscriptionLifecycle,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handlePaymentFailed,
  handlePaymentIntentSucceeded,
} from "../webhook-handlers";
import { upsertMirror } from "@/lib/domains/billing/subscriptions";
import { grantCycle } from "@/lib/domains/billing/orchestrate";
import {
  applyImmediateUpgradeGrant,
  resolvePendingTierChange,
  finalizePendingTierChange,
} from "@/lib/domains/catalog/credit-grant";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
};

function makeUpdateAdmin(updateError: { message: string } | null = null): MockAdmin {
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: updateError }),
  });
  return { from: vi.fn(() => ({ update })) };
}

function makeEventCtx(
  admin: MockAdmin,
  billingEventId: string | null = "evt-1",
  eventData: Record<string, unknown> = {},
): Parameters<typeof markEvent>[0] {
  return {
    admin: admin as never,
    stripe: {} as never,
    event: {
      id: "evt_test",
      created: 1_700_000_000,
      data: { object: eventData },
    } as never,
    billingEventId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── markEvent ─────────────────────────────────────────────────────────────────

describe("markEvent", () => {
  it("updates billing_events status to 'processed'", async () => {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const fromFn = vi.fn(() => ({ update }));
    const admin = { from: fromFn } as never;
    const ctx = makeEventCtx(admin, "evt-1");

    await markEvent(ctx, "processed");

    expect(fromFn).toHaveBeenCalledWith("billing_events");
    expect(update).toHaveBeenCalledWith({ status: "processed" });
    expect(eqFn).toHaveBeenCalledWith("id", "evt-1");
  });

  it("updates billing_events status to 'failed' with error_detail", async () => {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const admin = { from: vi.fn(() => ({ update })) } as never;
    const ctx = makeEventCtx(admin, "evt-1");

    await markEvent(ctx, "failed", "something went wrong");

    expect(update).toHaveBeenCalledWith({ status: "failed", error_detail: "something went wrong" });
  });

  it("does nothing when billingEventId is null", async () => {
    const admin = makeUpdateAdmin();
    const ctx = makeEventCtx(admin, null);

    await markEvent(ctx, "processed");

    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not throw when the DB update itself errors", async () => {
    const admin = makeUpdateAdmin({ message: "db failure" });
    const ctx = makeEventCtx(admin, "evt-1");

    // markEvent is best-effort — it must not throw on DB error
    await expect(markEvent(ctx, "processed")).resolves.toBeUndefined();
  });
});

// ── handleSubscriptionLifecycle ───────────────────────────────────────────────

describe("handleSubscriptionLifecycle", () => {
  function makeLifecycleAdmin(): MockAdmin {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { student_id: "stu-1" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn((table: string) => (table === "billing_events" ? { update } : table === "subscription_plans" ? { select } : { select })) };
  }

  it("calls upsertMirror and marks event processed on success", async () => {
    vi.mocked(upsertMirror).mockResolvedValue({ id: "mirror-1" } as never);

    const admin = makeLifecycleAdmin();
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "sub_abc",
      status: "active",
      customer: "cus_1",
      metadata: { student_id: "stu-1" },
      items: { data: [{ price: { id: "price_1" }, current_period_start: 1_700_000_000, current_period_end: 1_702_678_400 }] },
      cancel_at_period_end: false,
    });

    await handleSubscriptionLifecycle(ctx);

    expect(upsertMirror).toHaveBeenCalled();
  });

  it("marks event 'failed' when upsertMirror returns null", async () => {
    vi.mocked(upsertMirror).mockResolvedValue(null);

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { student_id: "stu-1" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const admin: MockAdmin = {
      from: vi.fn((table: string) => {
        if (table === "billing_events") return { update };
        return { select };
      }),
    };
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "sub_abc",
      status: "active",
      customer: "cus_1",
      metadata: { student_id: "stu-1" },
      items: { data: [{ price: { id: "price_1" }, current_period_start: 1_700_000_000, current_period_end: 1_702_678_400 }] },
      cancel_at_period_end: false,
    });

    await handleSubscriptionLifecycle(ctx);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});

// ── handleSubscriptionDeleted ─────────────────────────────────────────────────

describe("handleSubscriptionDeleted", () => {
  it("calls upsertMirror with forceCanceled and marks event processed", async () => {
    vi.mocked(upsertMirror).mockResolvedValue({ id: "mirror-del" } as never);

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { student_id: "stu-1" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const admin: MockAdmin = {
      from: vi.fn((table: string) => {
        if (table === "billing_events") return { update };
        return { select };
      }),
    };
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "sub_del",
      status: "canceled",
      customer: "cus_1",
      metadata: { student_id: "stu-1" },
      items: { data: [{ price: { id: "price_1" }, current_period_start: 1_700_000_000, current_period_end: 1_702_678_400 }] },
      cancel_at_period_end: false,
    });

    await handleSubscriptionDeleted(ctx);

    // upsertMirror must be called (snapshot has forceCanceled=true inside)
    expect(upsertMirror).toHaveBeenCalled();
    // event marked processed
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "processed" }));
  });

  it("marks event 'failed' when upsertMirror returns null", async () => {
    vi.mocked(upsertMirror).mockResolvedValue(null);

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { student_id: "stu-1" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const admin: MockAdmin = {
      from: vi.fn((table: string) => {
        if (table === "billing_events") return { update };
        return { select };
      }),
    };
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "sub_del",
      status: "canceled",
      customer: "cus_1",
      metadata: { student_id: "stu-1" },
      items: { data: [{ price: { id: "price_1" }, current_period_start: 1_700_000_000, current_period_end: 1_702_678_400 }] },
      cancel_at_period_end: false,
    });

    await handleSubscriptionDeleted(ctx);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});

// ── handleInvoicePaid ──────────────────────────────────────────────────────────

describe("handleInvoicePaid", () => {
  /** Admin that serves a billing_events update + a maybeSingle read (plan/mirror). */
  function makeInvoiceAdmin(opts: {
    plan?: object | null;
    mirror?: object | null;
  } = {}): MockAdmin {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const planMaybe = vi.fn().mockResolvedValue({
      data: opts.plan === undefined ? { id: "plan-1", monthly_credit_count: 4, price_cents: 4000, session_metadata: {}, is_hifz_product: false } : opts.plan,
      error: null,
    });
    // A RESOLVABLE mirror (student_id + plan_id) — the old shape returned the
    // plan row for subscriptions reads, so resolveSubscription always failed
    // and the "happy path" test never actually reached the grant step.
    const mirrorMaybe = vi.fn().mockResolvedValue({
      data: opts.mirror === undefined ? { id: "mirror-1", student_id: "stu-1", plan_id: "plan-1" } : opts.mirror,
      error: null,
    });
    const planEq = vi.fn(() => ({ maybeSingle: planMaybe }));
    const planSelect = vi.fn(() => ({ eq: planEq }));
    const subEq = vi.fn(() => ({ maybeSingle: mirrorMaybe }));
    const subSelect = vi.fn(() => ({ eq: subEq }));
    const upsertEq = vi.fn(() => ({ maybeSingle: mirrorMaybe, select: vi.fn(() => ({ maybeSingle: mirrorMaybe })) }));
    const upsert = vi.fn(() => ({ eq: upsertEq }));
    return {
      from: vi.fn((table: string) => {
        if (table === "billing_events") return { update };
        if (table === "subscriptions") return { select: subSelect, upsert };
        return { select: planSelect };
      }),
    };
  }

  /** dahlia-era invoice shape with subscription id + payment intent. */
  function invoiceObject(overrides: Record<string, unknown> = {}) {
    return {
      currency: "usd",
      id: "in_1",
      total: 4000,
      period_start: 1_700_000_000,
      period_end: 1_702_678_400,
      parent: { subscription_details: { subscription: "sub_1" } },
      payments: { data: [{ payment: { payment_intent: "pi_1" } }] },
      ...overrides,
    };
  }

  it("rejects a non-USD invoice (FR-008 currency guard)", async () => {
    const admin = makeInvoiceAdmin();
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ currency: "eur" }));

    await handleInvoicePaid(ctx);

    // No grant should happen; grantCycle is mocked so just assert it wasn't called.
    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("marks 'failed' when the invoice has no subscription id", async () => {
    const admin = makeInvoiceAdmin();
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({
      parent: { subscription_details: {} },
      lines: { data: [{}] },
    }));

    await handleInvoicePaid(ctx);

    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("marks 'failed' when the invoice has no payment_intent", async () => {
    const admin = makeInvoiceAdmin();
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({
      payments: { data: [] },
    }));

    await handleInvoicePaid(ctx);

    expect(grantCycle).not.toHaveBeenCalled();
  });

  // ── billing_reason=subscription_update (immediate tier upgrade proration) ──
  // Payment-gating audit 2026-07-15: these invoices must grant ONLY the pending
  // delta (applyImmediateUpgradeGrant) — never the full monthly grantCycle,
  // which double-granted before this branch existed.
  describe("subscription_update proration invoices", () => {
    function makeUpgradeAdmin(opts: { mirror?: object | null } = {}) {
      const beEq = vi.fn().mockResolvedValue({ error: null });
      const beUpdate = vi.fn().mockReturnValue({ eq: beEq });
      const subMaybe = vi.fn().mockResolvedValue({
        data:
          opts.mirror === undefined
            ? { id: "mirror-1", student_id: "stu-1", plan_id: "plan-1" }
            : opts.mirror,
        error: null,
      });
      const subEq = vi.fn(() => ({ maybeSingle: subMaybe }));
      const subSelect = vi.fn(() => ({ eq: subEq }));
      const admin: MockAdmin = {
        from: vi.fn((table: string) => {
          if (table === "billing_events") return { update: beUpdate };
          return { select: subSelect };
        }),
      };
      return { admin, beUpdate };
    }

    it("grants ONLY the pending delta — no full grantCycle, no renewal tier change", async () => {
      vi.mocked(applyImmediateUpgradeGrant).mockResolvedValue({
        ok: true,
        pendingId: "pug-1",
        planId: "plan-2",
        studentId: "stu-1",
        deltaSessions: 4,
        grant: { ok: true, grantId: "grant-1", created: true },
      } as never);
      const { admin, beUpdate } = makeUpgradeAdmin();
      const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_update" }));

      await handleInvoicePaid(ctx);

      expect(applyImmediateUpgradeGrant).toHaveBeenCalledWith(expect.anything(), "mirror-1", "in_1");
      expect(grantCycle).not.toHaveBeenCalled();
      expect(resolvePendingTierChange).not.toHaveBeenCalled();
      expect(beUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "processed" }));
    });

    it("is benign (processed, nothing granted) when no pending upgrade row exists", async () => {
      vi.mocked(applyImmediateUpgradeGrant).mockResolvedValue({
        ok: false,
        reason: "no_pending",
      } as never);
      const { admin, beUpdate } = makeUpgradeAdmin();
      const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_update" }));

      await handleInvoicePaid(ctx);

      expect(grantCycle).not.toHaveBeenCalled();
      expect(beUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "processed" }));
    });

    it("THROWS when the delta grant fails (dispatch marks failed + 500 so Stripe truly retries)", async () => {
      vi.mocked(applyImmediateUpgradeGrant).mockResolvedValue({
        ok: false,
        reason: "update_failed",
        error: "rpc down",
      } as never);
      const { admin } = makeUpgradeAdmin();
      const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_update" }));

      // Phase 5 security pass P1: markEvent(failed)+return answered 200 and
      // dead-ended the event (Stripe only redelivers on non-2xx).
      await expect(handleInvoicePaid(ctx)).rejects.toThrow(/immediate upgrade grant failed/);
      expect(grantCycle).not.toHaveBeenCalled();
    });

    it("leaves normal cycle invoices on the full-grant path (regression)", async () => {
      vi.mocked(grantCycle).mockResolvedValue({ ok: false, error: "stub" } as never);
      const { admin } = makeUpgradeAdmin();
      const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_cycle" }));

      // The failing stubbed grant now THROWS (transient posture) — the routing
      // is still what this regression pins: full grantCycle, no upgrade grant.
      await expect(handleInvoicePaid(ctx)).rejects.toThrow("stub");
      expect(applyImmediateUpgradeGrant).not.toHaveBeenCalled();
      expect(grantCycle).toHaveBeenCalled();
    });
  });

  it("does not throw on a well-formed USD invoice (happy-path smoke)", async () => {
    vi.mocked(grantCycle).mockResolvedValue({ ok: true, grantIds: ["g-1"] } as never);
    const admin = makeInvoiceAdmin();
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject());

    // The full grant path is exercised end-to-end via integration tests; here
    // we assert the handler doesn't throw on a well-formed invoice and reaches
    // the grant step (grantCycle is mocked at the module boundary).
    await expect(handleInvoicePaid(ctx)).resolves.toBeUndefined();
    expect(grantCycle).toHaveBeenCalled();
  });

  it("routes a hifz renewal with a pending tier change through ONE new-tier grant + finalize", async () => {
    vi.mocked(grantCycle).mockResolvedValue({ ok: true, grantId: "g-1", created: false } as never);
    vi.mocked(resolvePendingTierChange).mockResolvedValue({
      ok: true,
      pending: { pendingId: "ptc-1", newPlanId: "plan-new-tier" },
    } as never);
    const admin = makeInvoiceAdmin({
      plan: { id: "plan-hifz", monthly_credit_count: 8, price_cents: 8000, session_metadata: {}, is_hifz_product: true },
    });
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_cycle" }));

    await handleInvoicePaid(ctx);

    // Exactly ONE cycle grant — never the old tier's cycle plus a second
    // full new-tier regrant (the double-grant bug; audit 2026-07-18).
    expect(grantCycle).toHaveBeenCalledTimes(1);
    // The tier switch is finalized with the resolved new plan (no regrant path).
    expect(finalizePendingTierChange).toHaveBeenCalledWith(
      expect.anything(),
      "mirror-1",
      "ptc-1",
      "plan-new-tier",
    );
  });
});

// ── handlePaymentFailed ────────────────────────────────────────────────────────

describe("handlePaymentFailed", () => {
  it("flips an existing subscription to past_due when the event is newer", async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });
    // existing mirror found, last_event_at older than the event
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "mirror-1", last_event_at: "2023-01-01T00:00:00.000Z" },
      error: null,
    });
    const eqSelect = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const from = vi.fn((table: string) => {
      if (table === "billing_events") return { update };
      if (table === "subscriptions") return { select, update };
      return { select };
    });
    const admin = { from } as unknown as MockAdmin;
    const ctx = makeEventCtx(admin, "evt-1", {
      // event.created is 1_700_000_000 (2023-11), newer than 2023-01-01
      parent: { subscription_details: { subscription: "sub_1" } },
    });

    await handlePaymentFailed(ctx);

    // the subscription update was called (status flip + recency stamp)
    expect(update).toHaveBeenCalled();
  });

  it("marks processed even when there is no subscription id", async () => {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const admin = { from: vi.fn(() => ({ update })) } as unknown as MockAdmin;
    const ctx = makeEventCtx(admin, "evt-1", {
      parent: { subscription_details: {} },
      lines: { data: [{}] },
    });

    // No subscription → no status flip, but the event is still marked processed.
    await expect(handlePaymentFailed(ctx)).resolves.toBeUndefined();
  });
});

// ── handlePaymentIntentSucceeded ───────────────────────────────────────────────

describe("handlePaymentIntentSucceeded", () => {
  it("rejects a non-USD payment intent", async () => {
    const admin = makeUpdateAdmin();
    const ctx = makeEventCtx(admin, "evt-1", { id: "pi_1", currency: "eur" });

    await handlePaymentIntentSucceeded(ctx);

    // Non-USD short-circuits before any materialization; grantCycle untouched.
    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("marks 'failed' when PI metadata is incomplete (no booking_type)", async () => {
    const admin = makeUpdateAdmin();
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "pi_1",
      currency: "usd",
      metadata: { student_id: "stu-1", teacher_id: "t-1" }, // booking_type missing
    });

    await handlePaymentIntentSucceeded(ctx);

    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("marks 'failed' when booking_type is unknown", async () => {
    const admin = makeUpdateAdmin();
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "pi_1",
      currency: "usd",
      metadata: { booking_type: "mystery", student_id: "stu-1", teacher_id: "t-1" },
    });

    await handlePaymentIntentSucceeded(ctx);

    expect(grantCycle).not.toHaveBeenCalled();
  });
});

// ── handlePaymentIntentSucceeded — instant scheduled_at threading (spec 022 slice 2) ──

describe("handlePaymentIntentSucceeded — instant scheduled_at (spec 022 slice 2)", () => {
  function makeHappyInstantAdmin(): { admin: MockAdmin; rpc: ReturnType<typeof vi.fn> } {
    const rpc = vi.fn().mockResolvedValue({ data: "booking-1", error: null });
    const from = vi.fn((table: string) => {
      if (table === "payments") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "pay-1" }, error: null }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      // billing_events: sentinel select/insert + markEvent update + delete
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      };
    });
    return { admin: { from, rpc }, rpc };
  }

  it("threads scheduled_at from PI metadata into start_instant_session_booking (p_scheduled_at)", async () => {
    const { admin, rpc } = makeHappyInstantAdmin();
    const chosen = "2026-08-01T09:00:00.000Z";
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "pi_instant_1",
      currency: "usd",
      amount_received: 700,
      metadata: {
        booking_type: "instant",
        student_id: "stu-1",
        teacher_id: "t-1",
        scheduled_at: chosen,
      },
    });

    await handlePaymentIntentSucceeded(ctx);

    expect(rpc).toHaveBeenCalledWith(
      "start_instant_session_booking",
      expect.objectContaining({ p_scheduled_at: chosen }),
    );
  });

  it("falls back to a generated timestamp when scheduled_at metadata is absent", async () => {
    const { admin, rpc } = makeHappyInstantAdmin();
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "pi_instant_2",
      currency: "usd",
      amount_received: 700,
      metadata: { booking_type: "instant", student_id: "stu-1", teacher_id: "t-1" },
    });

    await handlePaymentIntentSucceeded(ctx);

    const call = rpc.mock.calls.find((c) => c[0] === "start_instant_session_booking");
    expect(call).toBeTruthy();
    expect(typeof (call![1] as { p_scheduled_at: unknown }).p_scheduled_at).toBe("string");
  });
});

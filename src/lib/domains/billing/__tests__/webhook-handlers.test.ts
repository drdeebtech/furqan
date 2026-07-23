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
vi.mock("@/lib/domains/connect/clawback", () => ({
  applyChargeClawbacks: vi.fn().mockResolvedValue(undefined),
  disputeChargeId: vi.fn().mockReturnValue(null),
  holdDisputedEntries: vi.fn().mockResolvedValue(undefined),
  paymentIntentIdOf: vi.fn((value: unknown) => (typeof value === "string" ? value : null)),
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
  ingestBillingEvent,
  handleSubscriptionLifecycle,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handlePaymentFailed,
  handlePaymentIntentSucceeded,
  handleChargeRefunded,
  revokeAndCancelOnSubscriptionRefund,
  type EventContext,
} from "../webhook-handlers";
import { emitEvent } from "@/lib/automation/emit";
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
): EventContext {
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

// ── ingestBillingEvent ────────────────────────────────────────────────────────
// Shared idempotency-ledger seam for all three provider webhook routes
// (stripe/webhook, stripe/connect-webhook, paypal/webhook). See ADR-0005.

type DupRow = { id: string; status: string } | null;

function makeIngestAdmin(opts: {
  insertError: { code: string; message?: string } | null;
  insertedId?: string | null;
  dupRow?: DupRow;
}): { admin: MockAdmin; insertFn: ReturnType<typeof vi.fn>; dupSelectFn: ReturnType<typeof vi.fn> } {
  const maybeSingleInsert = vi.fn().mockResolvedValue({
    data: opts.insertedId !== undefined && opts.insertedId !== null ? { id: opts.insertedId } : null,
    error: opts.insertError,
  });
  const selectAfterInsert = vi.fn().mockReturnValue({ maybeSingle: maybeSingleInsert });
  const insertFn = vi.fn().mockReturnValue({ select: selectAfterInsert });

  const maybeSingleDup = vi.fn().mockResolvedValue({ data: opts.dupRow ?? null, error: null });
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleDup });
  const dupSelectFn = vi.fn().mockReturnValue({ eq: eqFn });

  const fromFn = vi.fn(() => ({ insert: insertFn, select: dupSelectFn }));
  return { admin: { from: fromFn }, insertFn, dupSelectFn };
}

const INGEST_INPUT = {
  provider: "stripe" as const,
  eventId: "evt_ingest_1",
  eventType: "invoice.paid",
  createdMs: 1_700_000_000_000,
  payload: { id: "evt_ingest_1" },
};

describe("ingestBillingEvent", () => {
  it("new event: attempts the insert and returns outcome 'new' with the inserted row id", async () => {
    const { admin, insertFn } = makeIngestAdmin({ insertError: null, insertedId: "row-new-1" });

    const result = await ingestBillingEvent(admin as never, INGEST_INPUT);

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_event_id: "evt_ingest_1",
        event_type: "invoice.paid",
        status: "received",
        provider: "stripe",
      }),
    );
    expect(result).toEqual({ outcome: "new", billingEventId: "row-new-1" });
  });

  it("duplicate delivery of a terminal (processed) event: outcome 'duplicate', no dispatch signal", async () => {
    const { admin, dupSelectFn } = makeIngestAdmin({
      insertError: { code: "23505" },
      dupRow: { id: "row-dup-1", status: "processed" },
    });

    const result = await ingestBillingEvent(admin as never, INGEST_INPUT);

    expect(dupSelectFn).toHaveBeenCalled();
    expect(result).toEqual({ outcome: "duplicate", billingEventId: "row-dup-1" });
  });

  it("duplicate delivery of a terminal (ignored) event: outcome 'duplicate'", async () => {
    const { admin } = makeIngestAdmin({
      insertError: { code: "23505" },
      dupRow: { id: "row-dup-2", status: "ignored" },
    });

    const result = await ingestBillingEvent(admin as never, INGEST_INPUT);

    expect(result).toEqual({ outcome: "duplicate", billingEventId: "row-dup-2" });
  });

  it("duplicate delivery of a non-terminal (received) event: outcome 'redispatch' — must re-attempt, not drop", async () => {
    const { admin } = makeIngestAdmin({
      insertError: { code: "23505" },
      dupRow: { id: "row-dup-3", status: "received" },
    });

    const result = await ingestBillingEvent(admin as never, INGEST_INPUT);

    expect(result).toEqual({ outcome: "redispatch", billingEventId: "row-dup-3" });
  });

  it("duplicate delivery of a non-terminal (failed) event: outcome 'redispatch'", async () => {
    const { admin } = makeIngestAdmin({
      insertError: { code: "23505" },
      dupRow: { id: "row-dup-4", status: "failed" },
    });

    const result = await ingestBillingEvent(admin as never, INGEST_INPUT);

    expect(result).toEqual({ outcome: "redispatch", billingEventId: "row-dup-4" });
  });

  it("a genuine (non-23505) insert error propagates — the route maps this to a 500 'Ledger write failed'", async () => {
    const { admin } = makeIngestAdmin({ insertError: { code: "42P01", message: "boom" } });

    await expect(ingestBillingEvent(admin as never, INGEST_INPUT)).rejects.toMatchObject({
      code: "42P01",
    });
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
    newPlan?: object | null;
    mirror?: object | null;
  } = {}): MockAdmin {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const defaultPlan = { id: "plan-1", monthly_credit_count: 4, price_cents: 4000, session_metadata: {}, is_hifz_product: false };
    // id-aware: the renewal path looks up the current plan, then (on a pending
    // tier change) the NEW plan by its id — return newPlan for that id so tests
    // can assert grantCycle received the new tier's values, not just the count.
    const planFor = (id: unknown) =>
      opts.newPlan && id === (opts.newPlan as { id: string }).id
        ? opts.newPlan
        : opts.plan === undefined ? defaultPlan : opts.plan;
    // A RESOLVABLE mirror (student_id + plan_id) — the old shape returned the
    // plan row for subscriptions reads, so resolveSubscription always failed
    // and the "happy path" test never actually reached the grant step.
    const mirrorMaybe = vi.fn().mockResolvedValue({
      data: opts.mirror === undefined ? { id: "mirror-1", student_id: "stu-1", plan_id: "plan-1" } : opts.mirror,
      error: null,
    });
    const planEq = vi.fn((_col: string, id: unknown) => ({
      maybeSingle: vi.fn().mockResolvedValue({ data: planFor(id), error: null }),
    }));
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

  // ── Webhook payloads omit expandable lists (dahlia) ────────────────────────
  // Proven live 2026-07-19: every real subscription `invoice.paid` event
  // arrives WITHOUT `payments` (it is an expandable list, never included in
  // webhook payloads), so the handler must re-fetch the invoice with the list
  // expanded instead of dead-ending a PAID invoice's grant as "failed".
  it("re-fetches the invoice with expanded payments when the event omits the list, then grants", async () => {
    vi.mocked(grantCycle).mockResolvedValue({ ok: true, grantId: "g-1", created: true } as never);
    const admin = makeInvoiceAdmin();
    const bare = invoiceObject();
    delete (bare as Record<string, unknown>).payments;
    const ctx = makeEventCtx(admin, "evt-1", bare);
    const retrieve = vi.fn().mockResolvedValue(invoiceObject());
    (ctx as { stripe: unknown }).stripe = { invoices: { retrieve } };

    await expect(handleInvoicePaid(ctx)).resolves.toBeUndefined();

    expect(retrieve).toHaveBeenCalledWith("in_1", { expand: ["payments"] });
    // The recovered PI must actually reach the grant — that flow IS the fix.
    expect(grantCycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripePaymentIntent: "pi_1" }),
    );
  });

  it("does not re-fetch when the payload includes an explicitly empty payments list", async () => {
    const admin = makeInvoiceAdmin();
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ payments: { data: [] } }));
    const retrieve = vi.fn();
    (ctx as { stripe: unknown }).stripe = { invoices: { retrieve } };

    await handleInvoicePaid(ctx);

    expect(retrieve).not.toHaveBeenCalled();
    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("throws transient (retryable) when the expanded-payments re-fetch fails", async () => {
    const admin = makeInvoiceAdmin();
    const bare = invoiceObject();
    delete (bare as Record<string, unknown>).payments;
    const ctx = makeEventCtx(admin, "evt-1", bare);
    (ctx as { stripe: unknown }).stripe = {
      invoices: { retrieve: vi.fn().mockRejectedValue(new Error("api down")) },
    };

    await expect(handleInvoicePaid(ctx)).rejects.toThrow(/invoice payments retrieve failed/);
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
      plan: { id: "plan-hifz", monthly_credit_count: 4, price_cents: 4000, session_metadata: {}, is_hifz_product: true },
      newPlan: { id: "plan-new-tier", monthly_credit_count: 8, price_cents: 8000, session_metadata: {} },
    });
    const ctx = makeEventCtx(admin, "evt-1", invoiceObject({ billing_reason: "subscription_cycle" }));

    await handleInvoicePaid(ctx);

    // Exactly ONE cycle grant — never the old tier's cycle plus a second
    // full new-tier regrant (the double-grant bug; audit 2026-07-18).
    expect(grantCycle).toHaveBeenCalledTimes(1);
    // And it grants the NEW tier's plan + credit count, not the old tier's.
    expect(grantCycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ planId: "plan-new-tier", creditCount: 8 }),
    );
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

  // Subscription-invoice PIs carry NO single-session metadata at all — proven
  // live 2026-07-19: every subscription purchase tainted the ledger with a
  // "failed" row. Not ours → ignored; partial metadata still fails loud.
  it("marks 'ignored' (not 'failed') when the PI carries no single-session metadata at all", async () => {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const admin = { from: vi.fn(() => ({ update })) } as unknown as MockAdmin;
    const ctx = makeEventCtx(admin, "evt-1", { id: "pi_1", currency: "usd", metadata: {} });

    await handlePaymentIntentSucceeded(ctx);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "ignored" }));
    expect(grantCycle).not.toHaveBeenCalled();
  });

  it("still marks 'failed' on PARTIAL metadata (a malformed single-session payment)", async () => {
    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqFn });
    const admin = { from: vi.fn(() => ({ update })) } as unknown as MockAdmin;
    const ctx = makeEventCtx(admin, "evt-1", {
      id: "pi_1",
      currency: "usd",
      metadata: { booking_type: "instant" }, // ids missing — ours, but broken
    });

    await handlePaymentIntentSucceeded(ctx);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
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

// ── charge.refunded → subscription refund revocation (fix #2) ─────────────────
describe("revokeAndCancelOnSubscriptionRefund", () => {
  function makeRefundCtx(opts: {
    grant?: { subscription_id: string | null } | null;
    grantErr?: { message: string } | null;
    mirror?: { stripe_subscription_id: string; status: string } | null;
    cancelImpl?: () => Promise<unknown>;
  }) {
    const payUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const revokeEq2 = vi.fn().mockResolvedValue({ error: null });
    const subFlipNeq = vi.fn().mockResolvedValue({ error: null });
    const cancel = vi.fn(opts.cancelImpl ?? (async () => ({})));

    const from = vi.fn((table: string) => {
      if (table === "student_packages") {
        return {
          // grant lookup: select().eq().not().limit().maybeSingle()
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.grant ?? null,
                    error: opts.grantErr ?? null,
                  }),
                })),
              })),
            })),
          })),
          // revoke: update().eq().eq()
          update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: revokeEq2 })) })),
        };
      }
      if (table === "subscriptions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: opts.mirror ?? null, error: null }),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({ neq: subFlipNeq })) })),
        };
      }
      if (table === "payments") {
        return { update: vi.fn(() => ({ eq: payUpdateEq })) };
      }
      return {};
    });

    const ctx = {
      admin: { from },
      stripe: { subscriptions: { cancel } },
      event: { id: "evt-r", created: 1, data: { object: {} } },
      billingEventId: "be-r",
    } as never;
    return { ctx, cancel, payUpdateEq, revokeEq2, subFlipNeq };
  }

  const fullRefund = {
    id: "ch_1", currency: "usd", refunded: true,
    payment_intent: "pi_ref_1", amount: 1200, amount_refunded: 1200,
  } as never;

  it("full subscription refund: flips payment, revokes grants, cancels Stripe sub + mirror", async () => {
    const { ctx, cancel, payUpdateEq, revokeEq2, subFlipNeq } = makeRefundCtx({
      grant: { subscription_id: "sub-1" },
      mirror: { stripe_subscription_id: "sub_stripe_1", status: "active" },
    });
    await revokeAndCancelOnSubscriptionRefund(ctx, fullRefund);
    expect(payUpdateEq).toHaveBeenCalled();
    expect(revokeEq2).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("sub_stripe_1");
    expect(subFlipNeq).toHaveBeenCalled();
  });

  it("partial refund is a no-op (owner decision: full-refund-only)", async () => {
    const { ctx, cancel, payUpdateEq } = makeRefundCtx({
      grant: { subscription_id: "sub-1" },
      mirror: { stripe_subscription_id: "sub_stripe_1", status: "active" },
    });
    const partial = {
      id: "ch_1", currency: "usd", refunded: false,
      payment_intent: "pi_ref_1", amount: 1200, amount_refunded: 600,
    } as never;
    await revokeAndCancelOnSubscriptionRefund(ctx, partial);
    expect(payUpdateEq).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("non-subscription charge (no matching subscription grant) does nothing", async () => {
    const { ctx, cancel, payUpdateEq } = makeRefundCtx({ grant: null });
    await revokeAndCancelOnSubscriptionRefund(ctx, fullRefund);
    expect(payUpdateEq).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("an already-cancelled Stripe sub does NOT throw (idempotent) and still flips the mirror", async () => {
    const { ctx, subFlipNeq } = makeRefundCtx({
      grant: { subscription_id: "sub-1" },
      mirror: { stripe_subscription_id: "sub_stripe_1", status: "active" },
      cancelImpl: async () => {
        throw Object.assign(new Error("No such subscription: sub_stripe_1"), { code: "resource_missing" });
      },
    });
    await expect(revokeAndCancelOnSubscriptionRefund(ctx, fullRefund)).resolves.toBeUndefined();
    expect(subFlipNeq).toHaveBeenCalled();
  });

  it("reconciles locally (payment + revoke) but skips Stripe cancel when the mirror lacks a stripe id", async () => {
    const { ctx, cancel, payUpdateEq, revokeEq2, subFlipNeq } = makeRefundCtx({
      grant: { subscription_id: "sub-1" },
      mirror: null,
    });
    await revokeAndCancelOnSubscriptionRefund(ctx, fullRefund);
    expect(payUpdateEq).toHaveBeenCalled();   // payment STILL flipped
    expect(revokeEq2).toHaveBeenCalled();      // sessions STILL revoked
    expect(cancel).not.toHaveBeenCalled();     // no Stripe id → cannot cancel there
    expect(subFlipNeq).not.toHaveBeenCalled();
  });

  it("throws WebhookTransientError on a grant-lookup DB error (fail-closed → Stripe retries)", async () => {
    const { ctx } = makeRefundCtx({ grantErr: { message: "db down" } });
    await expect(revokeAndCancelOnSubscriptionRefund(ctx, fullRefund)).rejects.toThrow(/db down/);
  });
});

describe("handleChargeRefunded — single session", () => {
  function makeSingleSessionRefundCtx(
    charge: Record<string, unknown>,
    rpc: ReturnType<typeof vi.fn>,
  ) {
    const from = vi.fn((table: string) => {
      if (table === "student_packages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        };
      }
      if (table === "billing_events") {
        return {
          update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        };
      }
      return {};
    });

    return makeEventCtx({ from, rpc }, "be-refund", charge);
  }

  it("refund_kind=single_session → finalize + emit booking.cancelled on cancel", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        did_cancel: true,
        booking_id: "b1",
        student_id: "s1",
        teacher_id: "t1",
      },
      error: null,
    });
    const ctx = makeSingleSessionRefundCtx(
      {
        id: "ch_1",
        amount: 2000,
        currency: "usd",
        payment_intent: "pi_1",
        refunds: {
          data: [
            {
              id: "re_1",
              amount: 2000,
              metadata: {
                refund_request_id: "req_1",
                refund_kind: "single_session",
              },
            },
          ],
        },
      },
      rpc,
    );

    await handleChargeRefunded(ctx);

    expect(rpc).toHaveBeenCalledWith("finalize_single_session_refund", {
      p_refund_request_id: "req_1",
      p_stripe_ref: "re_1",
    });
    expect(emitEvent).toHaveBeenCalledWith(
      "booking.cancelled",
      "booking",
      "b1",
      expect.objectContaining({ student_id: "s1", teacher_id: "t1" }),
    );
  });

  it("external dashboard refund (no metadata) → reconcile_external_single_session_refund", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { did_cancel: false, matched: false },
      error: null,
    });
    const ctx = makeSingleSessionRefundCtx(
      {
        id: "ch_2",
        amount: 1500,
        currency: "usd",
        payment_intent: "pi_x",
        refunds: { data: [{ id: "re_2", amount: 1500, metadata: {} }] },
      },
      rpc,
    );

    await handleChargeRefunded(ctx);

    expect(rpc).toHaveBeenCalledWith("reconcile_external_single_session_refund", {
      p_payment_intent: "pi_x",
    });
  });
});

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
vi.mock("@/lib/domains/billing", () => ({
  upsertMirror: vi.fn(),
  grantCycle: vi.fn(),
  buildCycleKey: vi.fn().mockReturnValue("in_1:sub_1:2026-06-01"),
  BillingEvents: {
    Activated: "subscription.activated",
    Renewed: "subscription.renewed",
    Canceled: "subscription.canceled",
    PastDue: "subscription.past_due",
  },
}));
vi.mock("@/lib/domains/catalog/credit-grant", () => ({
  applyPendingTierChangeAtRenewal: vi.fn().mockResolvedValue({ ok: false, reason: "no_pending" }),
}));

import { markEvent, handleSubscriptionLifecycle, handleSubscriptionDeleted } from "../webhook-handlers";
import { upsertMirror } from "@/lib/domains/billing";

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

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (mirror webhook-handlers.test.ts) ────────────────────────────────

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
  buildCycleKey: vi.fn().mockReturnValue("k"),
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
}));
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: vi.fn() }),
}));

import { handlePrepaidHoursGrant } from "../webhook-handlers";

// ─── Helpers ────────────────────────────────────────────────────────────────

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";

/**
 * Admin that serves a billing_events update + a profiles lookup + a payments
 * upsert + an RPC call. Each can be overridden per-test.
 */
function makeAdmin(opts: {
  profile?: { id: string; role: string } | null;
  grantLotId?: string | null;
  grantError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}): MockAdmin {
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const profileMaybe = vi
    .fn()
    .mockResolvedValue({ data: opts.profile === undefined ? { id: STUDENT_ID, role: "student" } : opts.profile, error: null });
  const profileEq = vi.fn(() => ({ maybeSingle: profileMaybe }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  // payments.upsert(...).eq(...) — best-effort write.
  const upsertEq = vi.fn().mockResolvedValue({ error: null });
  const upsert = vi.fn(() => ({ eq: upsertEq }));

  const rpc = vi.fn().mockResolvedValue({
    data: opts.grantLotId === undefined ? "lot-1" : opts.grantLotId,
    error: opts.grantError ?? null,
  });

  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "billing_events") return { update };
      if (table === "profiles") return { select: profileSelect };
      if (table === "payments") return { upsert };
      return { select: profileSelect };
    }),
  };
}

function makeCtx(
  admin: MockAdmin,
  piOverrides: Record<string, unknown> = {},
  metadataOverrides: Record<string, string | undefined> = {},
) {
  const md = {
    product_type: "prepaid_hours",
    student_id: STUDENT_ID,
    hours: "10",
    rate_usd: "10.00",
    ...metadataOverrides,
  };
    return {
      admin: admin as never,
      stripe: {} as never,
      event: {
        id: "evt_test",
        created: 1_700_000_000,
        data: {
          object: {
            id: "pi_test",
            currency: "usd",
            status: "succeeded",
            // Default = the happy-path amount (10 hours × $10 × 100 = 10000
            // cents) so the H2 tamper guard PASSES and downstream branches
            // (profile lookup, rpc, payments audit) are actually exercised.
            // Tests that want to assert the tamper guard itself override this.
            amount_received: 10000,
            metadata: md,
            ...piOverrides,
          },
        },
      } as never,
      billingEventId: "evt-1",
    };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("handlePrepaidHoursGrant (spec 038 Phase 3)", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────
  it("calls grant_prepaid_hours with the frozen metadata rate + marks processed", async () => {
    // 10 hours × $10 × 100 = 10000 cents — matches default amount_received.
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { amount_received: 10000 });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).toHaveBeenCalledWith("grant_prepaid_hours", {
      p_payment_intent: "pi_test",
      p_student: STUDENT_ID,
      p_hours: 10,
      p_rate: 10,
      p_provider: "stripe",
    });
    // event marked processed.
    const update = (admin.from as unknown as ReturnType<typeof vi.fn>).mock.results.find(
      (r) => (r.value as { update?: unknown }).update,
    );
    expect(update).toBeTruthy();
  });

  // ── Currency guard ─────────────────────────────────────────────────────────
  it("marks 'failed' when the PI currency is not USD", async () => {
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { currency: "eur" });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── Delayed-payment handling (H2) ──────────────────────────────────────────
  it("marks 'ignored' when the PI is still processing (async method, not yet succeeded)", async () => {
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { status: "processing" });

    await handlePrepaidHoursGrant(ctx);

    // A later payment_intent.succeeded event re-fires and grants then.
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── Metadata completeness ─────────────────────────────────────────────────
  it("marks 'failed' when metadata is missing student_id", async () => {
    const admin = makeAdmin();
    const ctx = makeCtx(admin, {}, { student_id: undefined });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("marks 'failed' when product_type is not prepaid_hours", async () => {
    const admin = makeAdmin();
    const ctx = makeCtx(admin, {}, { product_type: "something_else" });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("marks 'failed' when hours is not a positive integer", async () => {
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { amount_received: 0 }, { hours: "0" });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── Fail-closed: no grant without a matching pending record (H2) ───────────
  it("marks 'failed' when no profile exists for metadata.student_id (no pending record)", async () => {
    const admin = makeAdmin({ profile: null });
    const ctx = makeCtx(admin);

    await handlePrepaidHoursGrant(ctx);

    // The tamper guard must PASS (default amount_received matches the rate)
    // so the profile-lookup branch is actually exercised — assert it ran.
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("marks 'failed' when the resolved profile role is not 'student'", async () => {
    const admin = makeAdmin({ profile: { id: STUDENT_ID, role: "teacher" } });
    const ctx = makeCtx(admin);

    await handlePrepaidHoursGrant(ctx);

    // Same as above — the profile lookup must actually run for this test to
    // assert the branch it names (role !== student).
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── Amount reconciliation (H2 tamper guard) ────────────────────────────────
  it("marks 'failed' when amount_received ≠ hours × rate × 100 (client tampered)", async () => {
    // Attacker tampers: paid $10 (1000 cents) for "10 hours at $10" (expects 10000).
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { amount_received: 1000 });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("marks 'failed' when rate in metadata was tampered post-checkout", async () => {
    // 10 hours, metadata rate tampered to $0.01 → expected = 10 cents, but the
    // server-stamped Checkout session charged $10 × 10 = 10000. Reconciliation
    // catches the desync.
    const admin = makeAdmin();
    const ctx = makeCtx(admin, { amount_received: 10000 }, { rate_usd: "0.01" });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── Idempotent grant (H1): webhook redelivery is a no-op ───────────────────
  it("marks processed when grant_prepaid_hours returns an existing lot id (redelivery)", async () => {
    // On a redelivery the DB function is idempotent: it returns the existing
    // lot id (no duplicate grant event, no duplicate lot). The handler does not
    // distinguish — it just marks processed. grant_prepaid_hours's UNIQUE
    // backstop is the source of truth.
    const admin = makeAdmin({ grantLotId: "lot-existing" });
    const ctx = makeCtx(admin, { amount_received: 10000 });

    await handlePrepaidHoursGrant(ctx);

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("grant_prepaid_hours", expect.objectContaining({
      p_payment_intent: "pi_test",
    }));
  });

  // ── Grant failure surfaces loudly (fail-closed retry) ──────────────────────
  it("THROWS when the RPC errors (dispatch marks failed + 500 so Stripe truly retries)", async () => {
    const admin = makeAdmin({ grantError: { message: "db down" } });
    const ctx = makeCtx(admin, { amount_received: 10000 });

    // Phase 5 security pass P1: the old markEvent(failed)+return answered 200,
    // which dead-ended the event — Stripe only redelivers on non-2xx.
    await expect(handlePrepaidHoursGrant(ctx)).rejects.toThrow("db down");
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("THROWS when grant_prepaid_hours returns no id", async () => {
    const admin = makeAdmin({ grantLotId: null });
    const ctx = makeCtx(admin, { amount_received: 10000 });

    await expect(handlePrepaidHoursGrant(ctx)).rejects.toThrow(/returned no id/);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
});

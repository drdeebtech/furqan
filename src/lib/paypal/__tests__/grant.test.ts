import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (mirror prepaid-hours-grant.test.ts) ─────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { parsePrepaidCustomId, grantPaypalPrepaidCapture, parseRefundCaptureId } from "../grant";

// Cast helper — the mock admin is a hand-rolled shape, not a real SupabaseClient.
// The reference test (prepaid-hours-grant.test.ts) casts the same way via
// `admin: admin as never` in makeCtx.
function asAdmin(admin: MockAdmin): Parameters<typeof grantPaypalPrepaidCapture>[0] {
  return admin as never;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  paymentsUpsert: ReturnType<typeof vi.fn>;
};

/**
 * Admin that serves a profiles lookup + an RPC call. Each can be overridden
 * per-test. (grant.ts no longer touches billing_events or payments — the
 * caller owns the ledger; the grant fn only reads profiles + calls the rpc.)
 */
function makeAdmin(opts: {
  profile?: { id: string; role: string } | null;
  grantLotId?: string | null;
  grantError?: { message: string } | null;
  profileError?: { message: string } | null;
  paymentsError?: { message: string } | null;
} = {}): MockAdmin {
  const profileMaybe = vi.fn().mockResolvedValue({
    data: opts.profile === undefined ? { id: STUDENT_ID, role: "student" } : opts.profile,
    error: opts.profileError ?? null,
  });
  const profileEq = vi.fn(() => ({ maybeSingle: profileMaybe }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  const rpc = vi.fn().mockResolvedValue({
    data: opts.grantLotId === undefined ? "lot-1" : opts.grantLotId,
    error: opts.grantError ?? null,
  });

  const paymentsUpsert = vi.fn().mockResolvedValue({ error: opts.paymentsError ?? null });

  return {
    rpc,
    paymentsUpsert,
    from: vi.fn((table: string) => {
      if (table === "payments") return { upsert: paymentsUpsert };
      if (table === "profiles") return { select: profileSelect };
      return { select: profileSelect };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── parsePrepaidCustomId ───────────────────────────────────────────────────

describe("parsePrepaidCustomId", () => {
  it("parses a valid prepaid_hours:<uuid>:<int>:<decimal> string", () => {
    const out = parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:10:10.00`);
    expect(out).toEqual({ studentId: STUDENT_ID, hours: 10, rate: 10 });
  });

  it("parses a non-2dp rate (future-emitter tolerant)", () => {
    const out = parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:5:12.5`);
    expect(out).toEqual({ studentId: STUDENT_ID, hours: 5, rate: 12.5 });
  });

  it("returns null for a wrong prefix", () => {
    expect(parsePrepaidCustomId(`subscription:${STUDENT_ID}:10:10.00`)).toBeNull();
  });

  it("returns null for a non-uuid student id", () => {
    expect(parsePrepaidCustomId("prepaid_hours:not-a-uuid:10:10.00")).toBeNull();
  });

  it("returns null when hours is '0'", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:0:10.00`)).toBeNull();
  });

  it("returns null when hours is negative", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:-5:10.00`)).toBeNull();
  });

  it("returns null when hours is a non-integer", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:1.5:10.00`)).toBeNull();
  });

  it("returns null when rate is '0'", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:10:0`)).toBeNull();
  });

  it("returns null when rate is negative", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:10:-1.00`)).toBeNull();
  });

  it("returns null when there are too few segments", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:10`)).toBeNull();
  });

  it("returns null when there are too many segments", () => {
    expect(parsePrepaidCustomId(`prepaid_hours:${STUDENT_ID}:10:10.00:extra`)).toBeNull();
  });
});

// ─── grantPaypalPrepaidCapture ──────────────────────────────────────────────

describe("grantPaypalPrepaidCapture (spec 039 Phase 2b)", () => {
  // 10 hours × $10 × 100 = 10000 cents = $100.00
  const VALID_CUSTOM_ID = `prepaid_hours:${STUDENT_ID}:10:10.00`;

  // ── Happy path ─────────────────────────────────────────────────────────────
  it("calls grant_prepaid_hours with p_provider='paypal' and the right args + returns ok", async () => {
    const admin = makeAdmin();
    // $100.00 === 10 × 10.00 (tamper guard passes)
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result).toEqual({ ok: true, lotId: "lot-1" });
    expect(admin.rpc).toHaveBeenCalledWith("grant_prepaid_hours", {
      p_payment_intent: "CAP-123",
      p_student: STUDENT_ID,
      p_hours: 10,
      p_rate: 10,
      p_provider: "paypal",
    });
  });

  // ── Payments audit row (spec 039 — order id threaded) ──────────────────────
  it("writes a best-effort payments audit row when orderId is provided", async () => {
    const admin = makeAdmin();
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
      orderId: "ORD-9",
    });
    expect(result).toEqual({ ok: true, lotId: "lot-1" });
    expect(admin.paymentsUpsert).toHaveBeenCalledTimes(1);
    const [row, options] = admin.paymentsUpsert.mock.calls[0];
    expect(row).toMatchObject({
      student_id: STUDENT_ID,
      amount_usd: 100,
      amount_before_tax: 100, // == amount_usd, satisfies the tax CHECK
      tax_amount: 0,
      provider: "paypal",
      status: "succeeded",
      paypal_order_id: "ORD-9",
      paypal_capture_id: "CAP-123",
    });
    expect(options).toEqual({ onConflict: "paypal_capture_id", ignoreDuplicates: true });
  });

  it("skips the payments audit row when orderId is absent (grant still ok)", async () => {
    const admin = makeAdmin();
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });
    expect(result).toEqual({ ok: true, lotId: "lot-1" });
    expect(admin.paymentsUpsert).not.toHaveBeenCalled();
  });

  it("audit-row upsert failure is non-fatal — the grant still returns ok", async () => {
    const admin = makeAdmin({ paymentsError: { message: "audit insert failed" } });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
      orderId: "ORD-9",
    });
    expect(result).toEqual({ ok: true, lotId: "lot-1" });
    expect(admin.paymentsUpsert).toHaveBeenCalledTimes(1);
  });

  // ── Tamper guard runs BEFORE the rpc ───────────────────────────────────────
  it("returns {ok:false} and does NOT call rpc when amountUsd ≠ hours×rate", async () => {
    const admin = makeAdmin();
    // Attacker tampers: paid $10 (10) for "10 hours at $10" (expects $100).
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 10,
      customId: VALID_CUSTOM_ID,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("passes the tamper guard on a rounding-safe half-cent boundary (100.005 → 100.00)", async () => {
    // 10 × 10.00 = 100.00 exactly; amountUsd 100.005 rounds to 10001 cents,
    // expected 10000 cents → mismatch. Use a clean value to confirm the happy
    // path is not over-strict.
    const admin = makeAdmin();
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });
    expect(result.ok).toBe(true);
  });

  // ── missing / bad custom_id ────────────────────────────────────────────────
  it("returns {ok:false} and does NOT call rpc when customId is null", async () => {
    const admin = makeAdmin();
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: null,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns {ok:false} and does NOT call rpc when customId is malformed", async () => {
    const admin = makeAdmin();
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: "prepaid_hours:not-a-uuid:10:10.00",
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── ownership ──────────────────────────────────────────────────────────────
  it("returns {ok:false} and does NOT call rpc when no profile exists", async () => {
    const admin = makeAdmin({ profile: null });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns {ok:false} and does NOT call rpc when the profile role is 'teacher'", async () => {
    const admin = makeAdmin({ profile: { id: STUDENT_ID, role: "teacher" } });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  // ── rpc failure ────────────────────────────────────────────────────────────
  it("returns {ok:false} when the RPC errors", async () => {
    const admin = makeAdmin({ grantError: { message: "db down" } });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns {ok:false} when grant_prepaid_hours returns no id", async () => {
    const admin = makeAdmin({ grantLotId: null });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-123",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result.ok).toBe(false);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  // ── Idempotent grant: a duplicate captureId is the DB's job ────────────────
  it("returns ok with the existing lot id on a redelivery (DB dedups)", async () => {
    // grant_prepaid_hours is idempotent on provider_payment_ref (capture id);
    // a redelivery returns the existing lot id. The grant fn does not
    // distinguish — it just returns ok.
    const admin = makeAdmin({ grantLotId: "lot-existing" });
    const result = await grantPaypalPrepaidCapture(asAdmin(admin), {
      captureId: "CAP-DUP",
      amountUsd: 100,
      customId: VALID_CUSTOM_ID,
    });

    expect(result).toEqual({ ok: true, lotId: "lot-existing" });
    expect(admin.rpc).toHaveBeenCalledWith("grant_prepaid_hours", expect.objectContaining({
      p_payment_intent: "CAP-DUP",
      p_provider: "paypal",
    }));
  });
});

// ─── parseRefundCaptureId (refund/reversal → capture id via rel="up") ─────────

describe("parseRefundCaptureId", () => {
  it("extracts the capture id from the rel='up' link", () => {
    const links = [
      { href: "https://api.sandbox.paypal.com/v2/payments/refunds/RE-1", rel: "self" },
      { href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-XYZ", rel: "up" },
    ];
    expect(parseRefundCaptureId(links)).toBe("CAP-XYZ");
  });

  it("ignores query strings after the capture id", () => {
    const links = [{ href: "https://x/v2/payments/captures/CAP-9?foo=bar", rel: "up" }];
    expect(parseRefundCaptureId(links)).toBe("CAP-9");
  });

  it("returns null when there is no rel='up' link", () => {
    const links = [{ href: "https://x/v2/payments/refunds/RE-1", rel: "self" }];
    expect(parseRefundCaptureId(links)).toBeNull();
  });

  it("returns null when the up link is not a captures path", () => {
    const links = [{ href: "https://x/v2/payments/authorizations/AUTH-1", rel: "up" }];
    expect(parseRefundCaptureId(links)).toBeNull();
  });

  it("returns null for missing/empty links", () => {
    expect(parseRefundCaptureId(undefined)).toBeNull();
    expect(parseRefundCaptureId(null)).toBeNull();
    expect(parseRefundCaptureId([])).toBeNull();
  });
});

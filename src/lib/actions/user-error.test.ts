import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the shared `UserError` — proving it is recognized by both:
 *   1. loudAction's `userError === true` duck-type (the contract that lets
 *      22 per-file classes be replaced by one import without touching the
 *      framework), AND
 *   2. cross-file `instanceof UserError` (the thing that only worked "by
 *      luck" before, because every file had its own distinct class).
 *
 * The first half drives a real loudAction so we observe the actual catch
 * branch, not a reimplementation of it.
 */

// ─── Mocks (mirror loud.test.ts so loudAction runs in isolation) ─────────────

const mockLogError = vi.fn();
const mockSendTelegramAlert = vi.fn();
const mockAttachGeo = vi.fn().mockResolvedValue(undefined);
const mockAuditInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    const result = fn();
    if (result instanceof Promise) result.catch(() => undefined);
  },
}));

vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn(), setTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));
vi.mock("@/lib/n8n/client", () => ({ sendTelegramAlert: (...a: unknown[]) => mockSendTelegramAlert(...a) }));
vi.mock("@/lib/sentry-geo", () => ({ attachGeoToSentryScope: () => mockAttachGeo() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mockAuditInsert }) }),
}));
vi.mock("server-only", () => ({}));

import { loudAction } from "./loud";
import { UserError, isUserError } from "./user-error";

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTelegramAlert.mockResolvedValue(undefined);
  mockAuditInsert.mockResolvedValue({ error: null });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("shared UserError — shape", () => {
  it("carries the userError duck-type flag and forwards cause", () => {
    const cause = new Error("db blew up");
    const err = new UserError("فشل", { cause });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UserError);
    expect((err as { userError: boolean }).userError).toBe(true);
    expect(err.name).toBe("UserError");
    expect(err.message).toBe("فشل");
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });

  it("isUserError recognizes both real instances and flag-only duck-types", () => {
    expect(isUserError(new UserError("x"))).toBe(true);
    // A foreign duck-typed error (e.g. loudUserError helper) still matches.
    const duck = Object.assign(new Error("y"), { userError: true as const });
    expect(isUserError(duck)).toBe(true);
    // Plain errors and non-errors do not.
    expect(isUserError(new Error("plain"))).toBe(false);
    expect(isUserError("nope")).toBe(false);
    expect(isUserError(null)).toBe(false);
  });
});

describe("shared UserError — recognized by loudAction's catch", () => {
  it("WITHOUT cause → silent passthrough (no Sentry/Telegram/FAILED audit)", async () => {
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.shared-no-cause",
      severity: "info",
      audit: { table: "t", recordId: (i) => i.id, action: "UPDATE" },
      handler: async () => {
        throw new UserError("ليس لديك صلاحية");
      },
    });

    const result = await action({ id: "x" });

    expect(result).toEqual({ ok: false, error: "ليس لديك صلاحية" });
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("WITH cause → logged system wrap (user still sees the friendly message)", async () => {
    const dbError = new Error("rls denial");
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.shared-with-cause",
      severity: "info",
      audit: { table: "t", recordId: (i) => i.id, action: "UPDATE" },
      handler: async () => {
        throw new UserError("فشل الحفظ", { cause: dbError });
      },
    });

    const result = await action({ id: "x" });

    expect(result).toEqual({ ok: false, error: "فشل الحفظ" });
    // The CAUSE is logged, not the user-facing wrapper.
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [, errorArg] = mockLogError.mock.calls[0]!;
    expect(errorArg).toBe(dbError);
    // FAILED audit row written.
    expect(mockAuditInsert).toHaveBeenCalledTimes(1);
    expect(mockAuditInsert.mock.calls[0]?.[0]).toMatchObject({
      reason: expect.stringContaining("FAILED"),
    });
  });
});

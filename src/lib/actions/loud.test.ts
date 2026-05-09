import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for `loudAction` — the no-silent-failures wrapper from spec 006.
 *
 * Goals (per spec 006 §SC-001..SC-004 + tasks.md T039):
 *   1. UserError thrown WITH `cause` (system error) → logError called
 *      with cause attached + audit FAILED row written.
 *   2. severity='critical' + cause → Telegram alert dispatched.
 *   3. severity='info' + cause → Telegram alert NOT dispatched.
 *   4. UserError thrown WITHOUT cause (pure preflight/validation) → NO
 *      logError, NO Telegram, NO FAILED audit row (silent passthrough).
 *   5. Happy path → audit success row written, no logError, no alert.
 *
 * The `after()` hook from `next/server` is mocked to invoke its callback
 * inline so we can synchronously observe audit + Telegram side-effects.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockLogError = vi.fn();
const mockSendTelegramAlert = vi.fn();
const mockAttachGeo = vi.fn().mockResolvedValue(undefined);
const mockAuditInsert = vi.fn().mockResolvedValue({ error: null });
const mockAddBreadcrumb = vi.fn();
const mockSetTag = vi.fn();

// Invoke `after()`'s callback inline — Next's actual `after` defers to the
// response boundary which doesn't exist in a node test runner.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    const result = fn();
    if (result instanceof Promise) {
      // Swallow background-task rejections the same way the framework does.
      result.catch(() => undefined);
    }
  },
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  setTag: (...args: unknown[]) => mockSetTag(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock("@/lib/n8n/client", () => ({
  sendTelegramAlert: (...args: unknown[]) => mockSendTelegramAlert(...args),
}));

vi.mock("@/lib/sentry-geo", () => ({
  attachGeoToSentryScope: () => mockAttachGeo(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: mockAuditInsert,
    }),
  }),
}));

// `server-only` is a runtime guard that throws in client bundles — no-op
// for the test runner.
vi.mock("server-only", () => ({}));

// Import AFTER mocks so the framework picks them up.
import { loudAction, notFoundOrInfra } from "./loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTelegramAlert.mockResolvedValue(undefined);
  mockAuditInsert.mockResolvedValue({ error: null });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("loudAction — happy path", () => {
  it("returns { ok: true, message } and writes a success audit row", async () => {
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.happy",
      severity: "info",
      audit: {
        table: "test",
        recordId: (i) => i.id,
        action: "UPDATE",
      },
      handler: async () => ({ message: "done" }),
    });

    const result = await action({ id: "abc" });

    expect(result).toEqual({ ok: true, message: "done" });
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
    expect(mockAuditInsert).toHaveBeenCalledTimes(1);
    const auditPayload = mockAuditInsert.mock.calls[0]?.[0];
    expect(auditPayload).toMatchObject({
      table_name: "test",
      record_id: "abc",
      action: "UPDATE",
      reason: expect.stringContaining("OK"),
    });
  });
});

describe("loudAction — UserError WITH cause (system error wrap)", () => {
  it("logs the underlying cause to Sentry + writes a FAILED audit row", async () => {
    const dbError = new Error("supabase RLS denial");
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.with-cause",
      severity: "info",
      audit: {
        table: "test",
        recordId: (i) => i.id,
        action: "UPDATE",
      },
      handler: async () => {
        throw new UserError("فشل الحفظ", { cause: dbError });
      },
    });

    const result = await action({ id: "x" });

    expect(result).toEqual({ ok: false, error: "فشل الحفظ" });

    // logError carries the cause, NOT the user-facing wrapper.
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [, errorArg, contextArg] = mockLogError.mock.calls[0]!;
    expect(errorArg).toBe(dbError);
    expect(contextArg).toMatchObject({
      tag: "loud-action",
      actionName: "test.with-cause",
      severity: "info",
    });

    // Failure audit row was written.
    expect(mockAuditInsert).toHaveBeenCalledTimes(1);
    const auditPayload = mockAuditInsert.mock.calls[0]?.[0];
    expect(auditPayload).toMatchObject({
      action: "UPDATE",
      reason: expect.stringContaining("FAILED"),
    });
  });

  it("on severity=critical, ALSO dispatches a Telegram alert", async () => {
    const dbError = new Error("paypal capture half-applied");
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.critical-with-cause",
      severity: "critical",
      handler: async () => {
        throw new UserError("تم الدفع لكن تعذر تحديث السجل", { cause: dbError });
      },
    });

    const result = await action({ id: "x" });

    expect(result).toEqual({
      ok: false,
      error: "تم الدفع لكن تعذر تحديث السجل",
    });
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockSendTelegramAlert).toHaveBeenCalledTimes(1);
    const tgMessage = mockSendTelegramAlert.mock.calls[0]?.[0];
    expect(tgMessage).toContain("Critical action failed");
    expect(tgMessage).toContain("test.critical-with-cause");
    // The user-facing message is escaped + included.
    expect(tgMessage).toContain("تم الدفع لكن تعذر تحديث السجل");
    // The underlying cause's message is included.
    expect(tgMessage).toContain("paypal capture half-applied");
  });

  it("on severity=info, does NOT dispatch a Telegram alert", async () => {
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.info-with-cause",
      severity: "info",
      handler: async () => {
        throw new UserError("فشل", { cause: new Error("rls denial") });
      },
    });

    await action({ id: "x" });

    expect(mockLogError).toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
  });
});

describe("loudAction — UserError WITHOUT cause (silent passthrough)", () => {
  it("returns { ok: false, error } but does NOT call Sentry/Telegram/FAILED audit", async () => {
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.no-cause",
      severity: "info",
      audit: {
        table: "test",
        recordId: (i) => i.id,
        action: "UPDATE",
      },
      handler: async () => {
        throw new UserError("غير مصرح");
      },
    });

    const result = await action({ id: "x" });

    expect(result).toEqual({ ok: false, error: "غير مصرح" });
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
    // No audit row on the no-cause throw — pure preflight/validation
    // failures aren't system events.
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });
});

describe("notFoundOrInfra", () => {
  it("PGRST116 (row-not-found) → plain UserError, no cause", async () => {
    const err = notFoundOrInfra({ code: "PGRST116", message: "no rows" }, "غير موجود");
    expect(err.name).toBe("UserError");
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("null/undefined err → plain UserError, no cause", async () => {
    const err = notFoundOrInfra(null, "غير موجود");
    expect(err.name).toBe("UserError");
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("any other code (network, RLS regression, schema mismatch) → UserError WITH cause attached", async () => {
    const supaErr = { code: "42501", message: "RLS denied" };
    const err = notFoundOrInfra(supaErr, "فشل");
    expect(err.name).toBe("UserError");
    expect((err as Error & { cause?: unknown }).cause).toBe(supaErr);
  });
});

describe("loudAction — schema validation", () => {
  it("validation failures return { ok: false } WITHOUT firing Sentry/Telegram/audit", async () => {
    const { z } = await import("zod");
    const action = loudAction<{ id: string }, { message: string }>({
      name: "test.schema",
      severity: "critical", // even on critical, validation is not a system fail
      schema: z.object({ id: z.string().uuid() }),
      audit: {
        table: "test",
        recordId: (i) => i.id,
        action: "UPDATE",
      },
      handler: async () => ({ message: "should not reach" }),
    });

    const result = await action({ id: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("بيانات غير صالحة");
    }
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });
});

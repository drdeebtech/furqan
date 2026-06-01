import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for `routeAction` — the route-adapter envelope factory.
 *
 * routeAction layers a `requireRole` preflight onto `loudAction`. The two
 * behaviors under test:
 *
 *   1. Error mapping: `requireRole` throwing `ForbiddenError` /
 *      `UnauthenticatedError` is surfaced as a cause-less { ok: false,
 *      error: "ليس لديك صلاحية" } — i.e. loudAction's silent passthrough
 *      (no Sentry / Telegram / FAILED audit). A NON-Forbidden throw from
 *      `requireRole` (real infra failure) is re-thrown so loudAction logs it
 *      as a system error.
 *
 *   2. Happy path: auth passes → handler runs with the authed id as
 *      ctx.actorId → { ok: true, message } + success audit row.
 *
 * Separately we assert the shared `UserError` is recognized by loudAction's
 * duck-type (the whole point of consolidating 22 per-file classes into one).
 *
 * `after()` is mocked to run inline so we can observe audit/Telegram
 * side-effects synchronously (same harness as loud.test.ts).
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockLogError = vi.fn();
const mockSendTelegramAlert = vi.fn();
const mockAttachGeo = vi.fn().mockResolvedValue(undefined);
const mockAuditInsert = vi.fn().mockResolvedValue({ error: null });
const mockRequireRole = vi.fn();

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    const result = fn();
    if (result instanceof Promise) result.catch(() => undefined);
  },
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
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
    from: () => ({ insert: mockAuditInsert }),
  }),
}));

// require-admin pulls in the Supabase server client + server-only barrier.
// Mock the whole module so the test only exercises routeAction's wiring:
// requireRole is the seam, ForbiddenError is the real class (re-exported from
// ./errors, which has no server-only barrier).
vi.mock("@/lib/auth/require-admin", async () => {
  const errors = await import("@/lib/auth/errors");
  return {
    requireRole: (...args: unknown[]) => mockRequireRole(...args),
    ForbiddenError: errors.ForbiddenError,
    UnauthenticatedError: errors.UnauthenticatedError,
  };
});

vi.mock("server-only", () => ({}));

// Import AFTER mocks.
import { routeAction } from "./route-action";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTelegramAlert.mockResolvedValue(undefined);
  mockAuditInsert.mockResolvedValue({ error: null });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("routeAction — happy path", () => {
  it("runs the handler with the authed id and returns { ok: true, message }", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    const handler = vi.fn().mockResolvedValue({ message: "تم" });

    const action = routeAction<{ x: number }, { message: string }>({
      name: "test.ok",
      role: "admin",
      audit: { table: "t", recordId: "r", action: "UPDATE" },
      handler,
    });

    const result = await action({ x: 1 });

    expect(result).toEqual({ ok: true, message: "تم" });
    // requireRole was called with the single role (not an array).
    expect(mockRequireRole).toHaveBeenCalledWith("admin");
    // ctx.actorId threaded from requireRole's { id }.
    expect(handler).toHaveBeenCalledWith({ x: 1 }, { actorId: "admin-1" });
    // Success audit row written; no error telemetry.
    expect(mockAuditInsert).toHaveBeenCalledTimes(1);
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
  });

  it("passes an array role through to requireRole unchanged (any-of gate)", async () => {
    mockRequireRole.mockResolvedValue({ id: "u-9", role: "teacher" });
    const action = routeAction<void, { message: string }>({
      name: "test.multi",
      role: ["teacher", "admin"],
      handler: async () => ({ message: "ok" }),
    });

    await action(undefined);

    expect(mockRequireRole).toHaveBeenCalledWith(["teacher", "admin"]);
  });
});

describe("routeAction — auth denial → silent passthrough", () => {
  it("maps ForbiddenError to a cause-less UserError (no Sentry/Telegram/FAILED audit)", async () => {
    mockRequireRole.mockRejectedValue(new ForbiddenError("not admin"));
    const handler = vi.fn();

    const action = routeAction<void, { message: string }>({
      name: "test.forbidden",
      role: "admin",
      audit: { table: "t", recordId: "r", action: "UPDATE" },
      handler,
    });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, error: "ليس لديك صلاحية" });
    // Handler never ran — auth gate short-circuited.
    expect(handler).not.toHaveBeenCalled();
    // Pure preflight failure: no system telemetry, no FAILED audit row.
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
    expect(mockAuditInsert).not.toHaveBeenCalled();
  });

  it("maps UnauthenticatedError (ForbiddenError subclass) the same way", async () => {
    mockRequireRole.mockRejectedValue(new UnauthenticatedError());

    const action = routeAction<void, { message: string }>({
      name: "test.unauthed",
      role: "admin",
      handler: async () => ({ message: "unreachable" }),
    });

    const result = await action(undefined);

    expect(result).toEqual({ ok: false, error: "ليس لديك صلاحية" });
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("routeAction — non-Forbidden auth failure → system error", () => {
  it("re-throws so loudAction logs it (NOT swallowed as user-facing)", async () => {
    // e.g. the auth round-trip itself blew up mid-flight (network, decode).
    const infraErr = new Error("auth round-trip exploded");
    mockRequireRole.mockRejectedValue(infraErr);

    const action = routeAction<void, { message: string }>({
      name: "test.infra",
      role: "admin",
      severity: "info",
      handler: async () => ({ message: "unreachable" }),
    });

    const result = await action(undefined);

    // loudAction caught the re-thrown infra error → system-failure path.
    expect(result).toEqual({ ok: false, error: "auth round-trip exploded" });
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [, errorArg] = mockLogError.mock.calls[0]!;
    expect(errorArg).toBe(infraErr);
  });
});

describe("routeAction — schema validation precedes auth (loudAction order preserved)", () => {
  it("invalid input returns a validation error without ever calling requireRole", async () => {
    const { z } = await import("zod");
    mockRequireRole.mockResolvedValue({ id: "admin-1" });

    const action = routeAction<{ id: string }, { message: string }>({
      name: "test.schema-first",
      role: "admin",
      schema: z.object({ id: z.string().uuid() }),
      handler: async () => ({ message: "unreachable" }),
    });

    const result = await action({ id: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("بيانات غير صالحة");
    // loudAction validates the schema BEFORE running preflight — so auth was
    // never consulted. This matches the order the migrated adapters relied on.
    expect(mockRequireRole).not.toHaveBeenCalled();
  });
});

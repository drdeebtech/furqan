import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { assertRole } from "./role-check";

// ---------------------------------------------------------------------------
// requireAdmin() mocks — hoisted before any import of require-admin
// ---------------------------------------------------------------------------

// server-only is a runtime guard — no-op in test environment
vi.mock("server-only", () => ({}));
// next/server is only needed by requireAdminForApi; stub enough for import
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init: unknown) => ({ body, init })),
  },
}));

const mockGetUser = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
  })),
}));

// withTimeout: pass through the first argument (the promise) so tests
// control results entirely through mockGetUser / mockSingle.
vi.mock("@/lib/promise-utils", () => ({
  withTimeout: (p: Promise<unknown>) => p,
}));

describe("assertRole", () => {
  it("returns nothing when actual role is in the allowed list", () => {
    expect(() => assertRole("admin", ["admin"])).not.toThrow();
    expect(() => assertRole("admin", ["admin", "teacher"])).not.toThrow();
    expect(() => assertRole("teacher", ["admin", "teacher"])).not.toThrow();
  });

  it("throws ForbiddenError when actual role is not in the allowed list", () => {
    expect(() => assertRole("teacher", ["admin"])).toThrow(ForbiddenError);
    expect(() => assertRole("student", ["admin", "teacher"])).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when actual role is null (profile lookup miss)", () => {
    // Treat missing role same as wrong role — caller doesn't have the
    // required permission either way. UnauthenticatedError is for missing
    // session, NOT for missing profile.
    expect(() => assertRole(null, ["admin"])).toThrow(ForbiddenError);
  });

  it("error message names the allowed role(s) for debuggability", () => {
    expect(() => assertRole("teacher", ["admin"])).toThrow(/not admin\b/);
    expect(() => assertRole("student", ["admin", "teacher"])).toThrow(/not admin or teacher\b/);
  });
});

describe("UnauthenticatedError", () => {
  it("is an instance of ForbiddenError (backward-compat for existing 38 importers)", () => {
    const err = new UnauthenticatedError();
    // The 38 callers all do `if (e instanceof ForbiddenError)` — that branch
    // must still match for unauthed cases. Per ADR-0001.
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).toBeInstanceOf(UnauthenticatedError);
  });

  it("has name='UnauthenticatedError' so error logging shows the right class", () => {
    expect(new UnauthenticatedError().name).toBe("UnauthenticatedError");
  });

  it("defaults to 'not authenticated' message", () => {
    expect(new UnauthenticatedError().message).toBe("not authenticated");
  });
});

// ---------------------------------------------------------------------------
// requireAdmin() — integration of getAuthedRole + assertRole
//
// Mocks: @/lib/supabase/server, @/lib/promise-utils (withTimeout passthrough)
// ---------------------------------------------------------------------------

// Static import — vi.mock calls above are hoisted by Vitest so mocks are
// in place before this module is evaluated.
import { requireAdmin, requireAdminForApi, requireRole } from "./require-admin";
import { createClient } from "@/lib/supabase/server";

beforeEach(() => {
  mockGetUser.mockReset();
  mockSingle.mockReset();
});

describe("requireAdmin", () => {
  it("throws UnauthenticatedError (a ForbiddenError) when getUser returns no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireAdmin()).rejects.toThrow(UnauthenticatedError);
    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when the profile role is 'student' (non-admin)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-42" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { role: "student" }, error: null });

    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when the profile role is 'teacher' (non-admin)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-43" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { role: "teacher" }, error: null });

    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
  });

  it("resolves with { id } when the profile role is 'admin'", async () => {
    const USER_ID = "admin-user-1";
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { role: "admin" }, error: null });

    await expect(requireAdmin()).resolves.toEqual({ id: USER_ID });
  });

  it("throws UnauthenticatedError when getUser throws (defensive catch)", async () => {
    mockGetUser.mockRejectedValue(new Error("session decode failure"));

    await expect(requireAdmin()).rejects.toThrow(UnauthenticatedError);
  });

  it("throws ForbiddenError when profile lookup throws (null role propagates to assertRole)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-99" } },
      error: null,
    });
    mockSingle.mockRejectedValue(new Error("network blip"));

    await expect(requireAdmin()).rejects.toThrow(ForbiddenError);
  });
});

describe("requireRole — multi-role array overload", () => {
  it("returns { id, role } when user has a role from the allowed set", async () => {
    const USER_ID = "teacher-1";
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mockSingle.mockResolvedValue({ data: { role: "teacher" }, error: null });

    const result = await requireRole(["admin", "teacher"] as const);
    expect(result).toEqual({ id: USER_ID, role: "teacher" });
  });

  it("throws ForbiddenError when user role is not in the multi-role allowed set", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "student-1" } }, error: null });
    mockSingle.mockResolvedValue({ data: { role: "student" }, error: null });

    await expect(requireRole(["admin", "teacher"] as const)).rejects.toThrow(ForbiddenError);
  });
});

describe("requireAdminForApi", () => {
  it("returns { id } when the user is an admin", async () => {
    const USER_ID = "admin-api-1";
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mockSingle.mockResolvedValue({ data: { role: "admin" }, error: null });

    const result = await requireAdminForApi();
    expect(result).toEqual({ id: USER_ID });
  });

  it("returns NextResponse 401 when user is unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireAdminForApi();
    // NextResponse.json is mocked to return { body, init }
    expect((result as { body: unknown; init: unknown }).body).toEqual({ error: "Unauthorized" });
    expect((result as { body: unknown; init: { status: number } }).init.status).toBe(401);
  });

  it("returns NextResponse 403 when session is valid but role is not admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "teacher-2" } }, error: null });
    mockSingle.mockResolvedValue({ data: { role: "teacher" }, error: null });

    const result = await requireAdminForApi();
    expect((result as { body: unknown; init: unknown }).body).toEqual({ error: "Forbidden" });
    expect((result as { body: unknown; init: { status: number } }).init.status).toBe(403);
  });

  it("re-throws unexpected errors (not auth-related)", async () => {
    // createClient() is called before any try/catch in getAuthedRole, so a
    // throw here escapes all auth catch blocks and hits the rethrow in requireAdminForApi.
    vi.mocked(createClient).mockRejectedValueOnce(new TypeError("db pool exhausted"));

    await expect(requireAdminForApi()).rejects.toThrow(TypeError);
  });
});

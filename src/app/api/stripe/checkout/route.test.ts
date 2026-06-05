import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const mockGetUser = vi.fn();
const mockProfileQuery = vi.fn();
const mockAdminQuery = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({ eq: () => ({ single: mockProfileQuery }) }),
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ single: mockAdminQuery }) }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(body: unknown): Request {
  return { json: async () => body } as Request;
}

async function status(res: Response): Promise<number> {
  return res.status;
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.clearAllMocks();
  // Authenticated student by default
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-uuid-0000-0000-000000000001" } } });
  mockProfileQuery.mockResolvedValue({ data: { role: "student" } });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

import { POST } from "./route";

describe("POST /api/stripe/checkout — input validation", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeReq({}));
    expect(await status(res)).toBe(401);
  });

  it("returns 403 when user is not a student", async () => {
    mockProfileQuery.mockResolvedValue({ data: { role: "teacher" } });
    const res = await POST(makeReq({ package_id: "00000000-0000-0000-0000-000000000001" }));
    expect(await status(res)).toBe(403);
  });

  it("returns 400 when package_id is missing", async () => {
    const res = await POST(makeReq({}));
    expect(await status(res)).toBe(400);
    expect((await json(res) as { error: string }).error).toBe("package_id required");
  });

  it("returns 400 with invalid UUID string (issue #408 repro)", async () => {
    const res = await POST(makeReq({ package_id: "test-valid-package-id" }));
    expect(await status(res)).toBe(400);
    expect((await json(res) as { error: string }).error).toBe("معرّف الحزمة غير صالح — invalid package_id");
  });

  it("returns 400 for other non-UUID strings", async () => {
    for (const bad of ["abc", "123", "not-a-uuid-at-all", "00000000-0000-0000"]) {
      const res = await POST(makeReq({ package_id: bad }));
      expect(await status(res)).toBe(400);
      expect((await json(res) as { error: string }).error).toBe("معرّف الحزمة غير صالح — invalid package_id");
    }
  });

  it("returns 400 when package_id is an array (typeof bypass attempt)", async () => {
    // RegExp.test() coerces arrays to strings; the typeof guard must block this
    const res = await POST(makeReq({ package_id: ["00000000-0000-0000-0000-000000000001"] }));
    expect(await status(res)).toBe(400);
    expect((await json(res) as { error: string }).error).toBe("معرّف الحزمة غير صالح — invalid package_id");
  });

  it("passes UUID validation and queries the DB for a well-formed UUID", async () => {
    mockAdminQuery.mockResolvedValue({ data: { id: "00000000-0000-0000-0000-000000000001", price_usd: 50, name: "Test" } });
    const res = await POST(makeReq({ package_id: "00000000-0000-0000-0000-000000000001" }));
    expect(await status(res)).toBe(501);
  });

  it("accepts uppercase UUIDs (regex flag /i)", async () => {
    mockAdminQuery.mockResolvedValue({ data: { id: "00000000-0000-0000-0000-000000000001", price_usd: 50, name: "Test" } });
    const res = await POST(makeReq({ package_id: "00000000-0000-0000-0000-000000000001".toUpperCase() }));
    expect(await status(res)).not.toBe(400);
  });

  it("returns 404 when package is not found", async () => {
    mockAdminQuery.mockResolvedValue({ data: null });
    const res = await POST(makeReq({ package_id: "00000000-0000-0000-0000-000000000001" }));
    expect(await status(res)).toBe(404);
  });
});

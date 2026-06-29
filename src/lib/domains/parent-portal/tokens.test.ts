import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Chainable admin-client mock; terminal calls (maybeSingle/insert/select) pull
// the next scripted result so each test sequences its own DB responses.
const results: unknown[] = [];
const chain: Record<string, ReturnType<typeof vi.fn>> = {
  from: vi.fn(() => chain),
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  is: vi.fn(() => chain),
  gt: vi.fn(() => chain),
  limit: vi.fn(() => chain),
  order: vi.fn(() => chain),
  returns: vi.fn(() => chain),
  maybeSingle: vi.fn(async () => results.shift() ?? { data: null, error: null }),
};
// insert/select resolve as thenables too (createParentToken awaits the insert).
chain.insert = vi.fn(() => ({ then: (r: (v: unknown) => unknown) => Promise.resolve(results.shift() ?? { error: null }).then(r) }));
chain.select = vi.fn(() => chain);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => chain }));

import { resolveParentToken, createParentToken } from "./tokens";

beforeEach(() => { results.length = 0; vi.clearAllMocks(); });

describe("resolveParentToken (fail-closed)", () => {
  it("returns the student for a valid, unrevoked, unexpired token", async () => {
    results.push({ data: { student_id: "stu-1", expires_at: new Date(Date.now() + 86400_000).toISOString(), revoked_at: null }, error: null });
    expect(await resolveParentToken("a".repeat(20))).toEqual({ studentId: "stu-1" });
  });

  it("returns null for a revoked token", async () => {
    results.push({ data: { student_id: "stu-1", expires_at: new Date(Date.now() + 86400_000).toISOString(), revoked_at: new Date().toISOString() }, error: null });
    expect(await resolveParentToken("a".repeat(20))).toBeNull();
  });

  it("returns null for an expired token", async () => {
    results.push({ data: { student_id: "stu-1", expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null }, error: null });
    expect(await resolveParentToken("a".repeat(20))).toBeNull();
  });

  it("returns null for an unknown token and rejects a too-short token without a query", async () => {
    expect(await resolveParentToken("short")).toBeNull();
    results.push({ data: null, error: null });
    expect(await resolveParentToken("a".repeat(20))).toBeNull();
  });
});

describe("createParentToken (authorization)", () => {
  it("throws not_authorized when a non-admin teacher has no booking with the student", async () => {
    results.push({ data: null, error: null }); // booking lookup → none
    await expect(createParentToken({ studentId: "stu-x", teacherId: "tch-1", isAdmin: false }))
      .rejects.toThrow("not_authorized");
  });

  it("mints a token when the teacher teaches the student", async () => {
    results.push({ data: { id: "bk-1" }, error: null }); // booking exists
    results.push({ error: null }); // insert ok
    const out = await createParentToken({ studentId: "stu-1", teacherId: "tch-1", isAdmin: false });
    expect(out.token).toBeTruthy();
    expect(typeof out.expiresAt).toBe("string");
  });

  it("skips the booking check for admins", async () => {
    results.push({ error: null }); // insert ok (no booking lookup consumed)
    const out = await createParentToken({ studentId: "stu-9", teacherId: "adm-1", isAdmin: true });
    expect(out.token).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Chainable admin-client mock. Builder methods return the chain; the terminals
// (maybeSingle/single) pull the next scripted result and THROW when none is
// scripted, so any stray/unexpected DB call fails the test loudly (CR #3).
const results: unknown[] = [];
const calls = { maybeSingle: 0, single: 0 };
const chain: Record<string, ReturnType<typeof vi.fn>> = {};
for (const m of ["from", "select", "insert", "update", "eq", "is", "gt", "limit", "order", "returns"]) {
  chain[m] = vi.fn(() => chain);
}
chain.maybeSingle = vi.fn(async () => {
  calls.maybeSingle++;
  if (results.length === 0) throw new Error("unscripted maybeSingle call");
  return results.shift();
});
chain.single = vi.fn(async () => {
  calls.single++;
  if (results.length === 0) throw new Error("unscripted single call");
  return results.shift();
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => chain }));

import { resolveParentToken, createParentToken } from "./tokens";

beforeEach(() => { results.length = 0; calls.maybeSingle = 0; calls.single = 0; });

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

  it("rejects a too-short token WITHOUT querying the DB", async () => {
    expect(await resolveParentToken("short")).toBeNull();
    expect(calls.maybeSingle).toBe(0); // no query was issued (CR #15)
  });

  it("returns null for an unknown token", async () => {
    results.push({ data: null, error: null });
    expect(await resolveParentToken("a".repeat(20))).toBeNull();
  });
});

describe("createParentToken (authorization + hashing)", () => {
  it("throws not_authorized when a non-admin teacher has no booking with the student", async () => {
    results.push({ data: null, error: null }); // booking lookup → none
    await expect(createParentToken({ studentId: "stu-x", teacherId: "tch-1", isAdmin: false }))
      .rejects.toThrow("not_authorized");
    expect(calls.single).toBe(0); // never reached the insert
  });

  it("mints a token (raw returned once) when the teacher teaches the student", async () => {
    results.push({ data: { id: "bk-1" }, error: null }); // booking exists
    results.push({ data: { id: "tok-1" }, error: null }); // insert .select().single()
    const out = await createParentToken({ studentId: "stu-1", teacherId: "tch-1", isAdmin: false });
    expect(out.token).toBeTruthy();
    expect(out.id).toBe("tok-1");
    expect(typeof out.expiresAt).toBe("string");
  });

  it("skips the booking check for admins", async () => {
    results.push({ data: { id: "tok-9" }, error: null }); // insert .select().single()
    const out = await createParentToken({ studentId: "stu-9", teacherId: "adm-1", isAdmin: true });
    expect(out.token).toBeTruthy();
    expect(out.id).toBe("tok-9");
  });
});

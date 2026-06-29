import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

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

// The active admin client is swappable: token-lifecycle tests use the FIFO
// `chain` above; the multi-table read test (getParentPortalView) swaps in a
// table-aware builder that resolves per (table, first-select-field).
let activeAdmin: unknown = chain;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => activeAdmin }));

import {
  resolveParentToken,
  createParentToken,
  getParentPortalView,
  listActiveParentTokens,
  revokeParentToken,
} from "./tokens";

beforeEach(() => { results.length = 0; calls.maybeSingle = 0; calls.single = 0; activeAdmin = chain; });

// Table-aware mock: every builder method is chainable; the terminals
// (maybeSingle/returns/single, and bare-await via `then`) resolve from
// `script` keyed by `table` or `table|firstSelectField`.
function makeTableAdmin(script: Record<string, { data: unknown; error: unknown }>) {
  function builder(table: string) {
    let selectStr = "";
    const resolve = () => {
      const first = selectStr.split(",")[0]?.trim() ?? "";
      return script[`${table}|${first}`] ?? script[table] ?? { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select(s: string) { if (!selectStr) selectStr = s; return b; },
      insert() { return b; },
      update() { return b; },
      eq() { return b; }, is() { return b; }, in() { return b; },
      gt() { return b; }, gte() { return b; }, order() { return b; }, limit() { return b; },
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      returns: async () => resolve(),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return b;
  }
  return { from: (t: string) => builder(t) };
}

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

  it("stores only the SHA-256 digest, never the raw token", async () => {
    results.push({ data: { id: "bk-1" }, error: null }); // booking exists
    results.push({ data: { id: "tok-1" }, error: null }); // insert .select().single()
    const out = await createParentToken({ studentId: "stu-1", teacherId: "tch-1", isAdmin: false });
    expect(out.token).toBeTruthy();
    expect(out.id).toBe("tok-1");
    expect(typeof out.expiresAt).toBe("string");

    // Inspect the actual insert payload — the persisted field must be the
    // digest of the returned token, and the raw token must NOT be stored.
    const payload = chain.insert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const expectedHash = createHash("sha256").update(out.token).digest("hex");
    expect(payload.token_hash).toBe(expectedHash);
    expect(payload.token_hash).not.toBe(out.token);
    expect(payload.token).toBeUndefined();
  });

  it("skips the booking check for admins (and still stores a digest)", async () => {
    results.push({ data: { id: "tok-9" }, error: null }); // insert .select().single()
    const out = await createParentToken({ studentId: "stu-9", teacherId: "adm-1", isAdmin: true });
    expect(out.token).toBeTruthy();
    expect(out.id).toBe("tok-9");
    const payload = chain.insert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.token_hash).toBe(createHash("sha256").update(out.token).digest("hex"));
    expect(payload.token).toBeUndefined();
  });
});

describe("getParentPortalView (scoped read + integrity filters)", () => {
  it("maps progress/sessions and drops sentinel + out-of-range recitation errors", async () => {
    activeAdmin = makeTableAdmin({
      "profiles|full_name": { data: { full_name: "Yusuf Ali Khan" }, error: null },
      "student_progress|surah_from": {
        data: [{ surah_from: 1, ayah_from: 1, surah_to: 1, ayah_to: 7, quality_rating: 5, created_at: "2026-06-20T00:00:00Z" }],
        error: null,
      },
      "bookings|scheduled_at": {
        data: [{ scheduled_at: "2026-07-01T00:00:00Z", session_type: "hifz", duration_min: 30 }],
        error: null,
      },
      "student_progress|id": { data: [{ id: "prog-1" }], error: null },
      "recitation_errors|error_type": {
        data: [
          { error_type: "madd", surah_num: 1, ayah_num: 2, note: "@1:23" },          // keep
          { error_type: "ghunna", surah_num: 1, ayah_num: 1, note: "__no_errors_observed_sentinel__" }, // drop (sentinel)
          { error_type: "waqf", surah_num: 1, ayah_num: 999, note: null },            // drop (ayah > surah range)
        ],
        error: null,
      },
    });

    const view = await getParentPortalView("stu-1");
    expect(view.studentFirstName).toBe("Yusuf"); // first name only — no PII leak
    expect(view.progress).toEqual([{ range: "1:1 – 1:7", quality: 5, date: "2026-06-20T00:00:00Z" }]);
    expect(view.upcomingSessions).toHaveLength(1);
    expect(view.recentErrors).toEqual([{ errorType: "madd", surah: 1, ayah: 2 }]);
  });

  it("returns a safe empty view when the student simply has no data (no error)", async () => {
    activeAdmin = makeTableAdmin({}); // every query → { data: null, error: null }
    const view = await getParentPortalView("stu-empty");
    expect(view.studentFirstName).toBe("الطالب"); // fallback, never undefined
    expect(view.progress).toEqual([]);
    expect(view.upcomingSessions).toEqual([]);
    expect(view.recentErrors).toEqual([]);
  });

  it("fails closed (throws) when a query errors — never renders misleading empty data", async () => {
    activeAdmin = makeTableAdmin({
      "profiles|full_name": { data: null, error: { message: "rls denied" } },
    });
    await expect(getParentPortalView("stu-1")).rejects.toThrow("parent_portal_read_failed");
  });
});

describe("listActiveParentTokens / revokeParentToken", () => {
  it("maps active token rows to camelCase", async () => {
    activeAdmin = makeTableAdmin({
      "parent_access_tokens|id": {
        data: [{ id: "tok-1", created_at: "2026-06-01T00:00:00Z", expires_at: "2026-07-01T00:00:00Z" }],
        error: null,
      },
    });
    const rows = await listActiveParentTokens({ studentId: "stu-1", teacherId: "tch-1" });
    expect(rows).toEqual([{ id: "tok-1", createdAt: "2026-06-01T00:00:00Z", expiresAt: "2026-07-01T00:00:00Z" }]);
  });

  it("throws not_found when revoke touches zero rows (wrong owner / missing)", async () => {
    activeAdmin = makeTableAdmin({ "parent_access_tokens|id": { data: [], error: null } });
    await expect(revokeParentToken({ tokenId: "tok-x", teacherId: "tch-2", isAdmin: false }))
      .rejects.toThrow("not_found");
  });

  it("resolves when revoke touches the owner's row", async () => {
    activeAdmin = makeTableAdmin({ "parent_access_tokens|id": { data: [{ id: "tok-1" }], error: null } });
    await expect(revokeParentToken({ tokenId: "tok-1", teacherId: "tch-1", isAdmin: false }))
      .resolves.toBeUndefined();
  });
});

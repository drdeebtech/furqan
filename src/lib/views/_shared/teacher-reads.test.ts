import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { recentWindow, resolveStudentNames } from "./teacher-reads";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.in.mockReturnThis();
});

describe("recentWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the ISO timestamp `days` ago (30-day boundary)", () => {
    expect(recentWindow(30)).toBe("2026-05-23T00:00:00.000Z");
  });

  it("honours a custom window (7-day boundary)", () => {
    expect(recentWindow(7)).toBe("2026-06-15T00:00:00.000Z");
  });

  it("defaults to a 30-day window", () => {
    expect(recentWindow()).toBe(recentWindow(30));
  });
});

describe("resolveStudentNames", () => {
  it("returns an empty Map and skips the query for empty ids", async () => {
    const result = await resolveStudentNames(chain as never, []);
    expect(result.size).toBe(0);
    expect(chain.from).not.toHaveBeenCalled();
  });

  it("maps id -> full_name and falls back to — for null names", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { id: "s1", full_name: "Aisha" },
        { id: "s2", full_name: null },
      ],
      error: null,
    });

    const result = await resolveStudentNames(chain as never, ["s1", "s2"]);
    expect(chain.from).toHaveBeenCalledWith("public_profiles");
    expect(result.get("s1")).toBe("Aisha");
    expect(result.get("s2")).toBe("—");
  });

  it("omits a missing id from the Map (caller applies — fallback)", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [{ id: "s1", full_name: "Aisha" }],
      error: null,
    });

    const result = await resolveStudentNames(chain as never, ["s1", "s2"]);
    expect(result.has("s2")).toBe(false);
    expect(result.get("s2") ?? "—").toBe("—");
  });

  it("throws when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(resolveStudentNames(chain as never, ["s1"])).rejects.toThrow("boom");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const loggerMock = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => loggerMock);

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { buildNameMap } from "./name-map";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.in.mockReturnThis();
});

describe("buildNameMap", () => {
  it("returns {} without querying when ids is empty", async () => {
    const result = await buildNameMap(chain as never, []);
    expect(result).toEqual({});
    expect(chain.from).not.toHaveBeenCalled();
  });

  it("maps found ids to their name, defaulting a null full_name to the fallback, and omits unresolved ids", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { id: "s1", full_name: "Aisha" },
        { id: "s2", full_name: null },
      ],
      error: null,
    });
    // s3 requested but not returned by the query (unresolved) — old
    // buildNameMap left it absent from the result object; preserved here.
    const result = await buildNameMap(chain as never, ["s1", "s2", "s3"]);
    expect(result).toEqual({ s1: "Aisha", s2: "—" });
  });

  it("uses a caller-supplied fallback in place of the default '—'", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [{ id: "s1", full_name: null }],
      error: null,
    });
    const result = await buildNameMap(chain as never, ["s1"], "No name");
    expect(result).toEqual({ s1: "No name" });
  });

  it("returns {} and logs instead of throwing when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("db fail") });
    const result = await buildNameMap(chain as never, ["s1"]);
    expect(result).toEqual({});
    expect(loggerMock.logError).toHaveBeenCalledTimes(1);
  });
});

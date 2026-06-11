import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chunk } from "./promise-utils";

// ─── withTimeout tests ────────────────────────────────────────────────────────

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

import { withTimeout } from "./promise-utils";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("resolves with the promise value when it settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 500, 0, "fast-query");
    expect(result).toBe(42);
  });

  it("returns fallback and calls logError when the promise times out", async () => {
    vi.useFakeTimers();
    const hanging = new Promise<number>(() => { /* never resolves */ });
    const racePromise = withTimeout(hanging, 100, -1, "slow-query");
    vi.advanceTimersByTime(200);
    const result = await racePromise;
    expect(result).toBe(-1);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0]![0]).toContain("slow-query");
    expect((mockLogError.mock.calls[0]![2] as Record<string, unknown>).tag).toBe("query-timeout");
  });

  it("returns fallback and calls logError when the promise rejects with a non-timeout error", async () => {
    const boom = Promise.reject(new Error("db down"));
    const result = await withTimeout(boom, 5000, "FALLBACK", "failing-query");
    expect(result).toBe("FALLBACK");
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0]![0]).toContain("failing-query");
    expect((mockLogError.mock.calls[0]![2] as Record<string, unknown>).tag).toBe("query-error");
  });

  it("logs 'query timeout' message (not 'query error') on timeout", async () => {
    vi.useFakeTimers();
    const hanging = new Promise<string>(() => { /* never resolves */ });
    const p = withTimeout(hanging, 50, "fb", "timeout-label");
    vi.advanceTimersByTime(100);
    await p;
    expect(mockLogError.mock.calls[0]![0]).toBe("query timeout: timeout-label");
  });

  it("logs 'query error' message (not 'query timeout') on rejection", async () => {
    const result = await withTimeout(Promise.reject(new Error("oops")), 5000, "fb", "error-label");
    expect(result).toBe("fb");
    expect(mockLogError.mock.calls[0]![0]).toBe("query error: error-label");
  });

  it("does not call logError when the promise resolves successfully", async () => {
    await withTimeout(Promise.resolve("ok"), 5000, "fb", "happy-path");
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("chunk", () => {
  it("splits into fixed-size chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when size >= length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("handles exact multiples", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("covers every element exactly once (1000-size over 2500)", () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i);
    const chunks = chunk(ids, 1000);
    expect(chunks.length).toBe(3);
    expect(chunks.map(c => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("throws on non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

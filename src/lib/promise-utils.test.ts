import { describe, it, expect } from "vitest";
import { chunk } from "./promise-utils";

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

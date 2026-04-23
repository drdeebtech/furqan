import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("joins simple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("flattens arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("merges conflicting tailwind padding (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("merges conflicting tailwind colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("preserves non-conflicting tailwind classes", () => {
    const result = cn("px-2", "py-4", "text-sm");
    expect(result).toContain("px-2");
    expect(result).toContain("py-4");
    expect(result).toContain("text-sm");
  });

  it("handles mixed conditionals with tailwind merging", () => {
    expect(cn("p-2", { "p-4": true, "m-2": false })).toBe("p-4");
  });

  it("dedupes identical classes via twMerge behavior", () => {
    // twMerge keeps last of conflicting; identical tokens collapse into one
    const result = cn("text-sm", "text-sm");
    expect(result).toBe("text-sm");
  });
});

import { describe, it, expect, vi } from "vitest";

// server-only is a runtime guard — no-op in test environment
vi.mock("server-only", () => ({}));
// unstable_cache is a Next.js server cache — return fn as-is in tests
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { isAllowedSettingKey, ALLOWED_SETTING_KEYS } from "./settings";

describe("isAllowedSettingKey", () => {
  it("returns true for all allowed setting keys", () => {
    ALLOWED_SETTING_KEYS.forEach((key) => {
      expect(isAllowedSettingKey(key)).toBe(true);
    });
  });

  it("returns false for invalid setting keys", () => {
    const invalidKeys = [
      "invalid_key",
      "HIDE_REVIEWS", // Uppercase
      "hide_review", // Typo
      "automationEnabled", // CamelCase
      "123",
      "",
    ];

    invalidKeys.forEach((key) => {
      expect(isAllowedSettingKey(key)).toBe(false);
    });
  });

  it("should be a type guard", () => {
    const key: string = "hide_reviews";
    if (isAllowedSettingKey(key)) {
      // This block is just to verify it compiles as a type guard
      const allowed: (typeof ALLOWED_SETTING_KEYS)[number] = key;
      expect(allowed).toBe("hide_reviews");
    }
  });
});

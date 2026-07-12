import { describe, expect, test } from "vitest";
import { isAuthorizedForStaging } from "./staging-gate";

const PASSWORD = "correct-horse";
const basic = (userColonPass: string) =>
  `Basic ${Buffer.from(userColonPass).toString("base64")}`;

describe("isAuthorizedForStaging", () => {
  test("rejects when no Authorization header is present", () => {
    expect(isAuthorizedForStaging(null, PASSWORD)).toBe(false);
  });

  test("rejects non-Basic schemes", () => {
    expect(isAuthorizedForStaging("Bearer abc123", PASSWORD)).toBe(false);
  });

  test("rejects malformed base64", () => {
    expect(isAuthorizedForStaging("Basic !!!not-base64!!!", PASSWORD)).toBe(false);
  });

  test("rejects a wrong password", () => {
    expect(isAuthorizedForStaging(basic("user:wrong"), PASSWORD)).toBe(false);
  });

  test("rejects a matching prefix of the password", () => {
    expect(isAuthorizedForStaging(basic("user:correct"), PASSWORD)).toBe(false);
  });

  test("rejects the password with trailing garbage", () => {
    expect(isAuthorizedForStaging(basic(`user:${PASSWORD}x`), PASSWORD)).toBe(false);
  });

  test("accepts the correct password regardless of username", () => {
    expect(isAuthorizedForStaging(basic(`anything:${PASSWORD}`), PASSWORD)).toBe(true);
    expect(isAuthorizedForStaging(basic(`:${PASSWORD}`), PASSWORD)).toBe(true);
  });

  test("accepts a password that itself contains colons (split on FIRST colon only)", () => {
    const colonPassword = "pa:ss:word";
    expect(isAuthorizedForStaging(basic(`user:${colonPassword}`), colonPassword)).toBe(true);
  });
});

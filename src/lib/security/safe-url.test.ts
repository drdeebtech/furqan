import { describe, expect, it } from "vitest";
import { isSafeRelativePath, safeHref } from "./safe-url";

describe("isSafeRelativePath", () => {
  it("accepts plain same-origin relative paths", () => {
    expect(isSafeRelativePath("/student/dashboard")).toBe(true);
    expect(isSafeRelativePath("/")).toBe(true);
    expect(isSafeRelativePath("/admin/users?tab=all")).toBe(true);
  });

  it("rejects null/empty/non-relative values", () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("https://evil.com")).toBe(false);
    expect(isSafeRelativePath("evil.com")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeRelativePath("//evil.com")).toBe(false);
  });

  it("rejects the backslash open-redirect bypass (browsers normalize \\ to /)", () => {
    // The exact payload the audit flagged on the Google OAuth callback.
    expect(isSafeRelativePath("/\\evil.com")).toBe(false);
    expect(isSafeRelativePath("/\\/evil.com")).toBe(false);
    expect(isSafeRelativePath("\\\\evil.com")).toBe(false);
  });

  it("rejects CRLF / NUL header-injection characters", () => {
    expect(isSafeRelativePath("/foo\r\nSet-Cookie: x=1")).toBe(false);
    expect(isSafeRelativePath("/foo\x00bar")).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isSafeRelativePath("/foo/../../etc/passwd")).toBe(false);
  });

  it("rejects percent-encoded traversal / control chars", () => {
    expect(isSafeRelativePath("/%2e%2e/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("/%2e%2e%2fevil")).toBe(false);
    expect(isSafeRelativePath("/foo%0d%0aSet-Cookie:x=1")).toBe(false);
    expect(isSafeRelativePath("/foo%5cevil.com")).toBe(false);
  });

  it("rejects malformed percent-sequences", () => {
    expect(isSafeRelativePath("/foo%")).toBe(false);
  });
});

describe("safeHref", () => {
  it("passes through http(s) absolute URLs", () => {
    expect(safeHref("https://furqan.today/x.pdf")).toBe("https://furqan.today/x.pdf");
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });

  it("passes through same-origin relative paths", () => {
    expect(safeHref("/student/resources")).toBe("/student/resources");
  });

  it("neutralizes javascript: URIs (stored XSS payload)", () => {
    expect(safeHref("javascript:alert(document.cookie)")).toBe("#");
    expect(safeHref("  JavaScript:alert(1)  ")).toBe("#");
  });

  it("neutralizes data: and vbscript: URIs", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeHref("vbscript:msgbox(1)")).toBe("#");
  });

  it("returns the fallback for null/empty and protocol-relative", () => {
    expect(safeHref(null)).toBe("#");
    expect(safeHref("")).toBe("#");
    expect(safeHref("//evil.com")).toBe("#");
    expect(safeHref(undefined, "/safe")).toBe("/safe");
  });
});

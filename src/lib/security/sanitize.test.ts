import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeHeaderValue } from "./sanitize";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("neutralizes a Telegram HTML-injection payload (anchor smuggling)", () => {
    const payload = `<a href="https://evil">Approve now</a>`;
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain("<a ");
    expect(escaped).toContain("&lt;a href=&quot;https://evil&quot;&gt;");
  });

  it("leaves benign text untouched", () => {
    expect(escapeHtml("Ali Hassan")).toBe("Ali Hassan");
  });
});

describe("sanitizeHeaderValue", () => {
  it("strips CR/LF to prevent email header injection", () => {
    expect(sanitizeHeaderValue("Ali\r\nBcc: victim@x.com")).toBe(
      "Ali Bcc: victim@x.com",
    );
  });

  it("collapses tabs/NUL and trims", () => {
    expect(sanitizeHeaderValue("  a\tb\x00c  ")).toBe("a b c");
  });

  it("caps length", () => {
    expect(sanitizeHeaderValue("x".repeat(500)).length).toBe(200);
    expect(sanitizeHeaderValue("abcdef", 3)).toBe("abc");
  });
});

import { describe, it, expect } from "vitest";
import { isSafePushEndpoint } from "./safe-endpoint";

describe("isSafePushEndpoint (SSRF-VULN-01)", () => {
  it("allows real push-service endpoints", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://android.googleapis.com/fcm/send/xyz",
      "https://updates.push.services.mozilla.com/wpush/v2/token",
      "https://abc.notify.windows.com/w/?token=1",
      "https://api.push.apple.com/3/device/deadbeef",
    ]) {
      expect(isSafePushEndpoint(ok), ok).toBe(true);
    }
  });

  it("blocks the confirmed SSRF targets", () => {
    // Both were accepted + stored live during the Shannon scan.
    expect(isSafePushEndpoint("https://169.254.169.254/")).toBe(false);
    expect(isSafePushEndpoint("https://127.0.0.1:8443/")).toBe(false);
  });

  it("blocks IP-literals in any form", () => {
    for (const bad of [
      "https://10.0.0.5/",
      "https://192.168.1.1/x",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://2130706433/", // decimal 127.0.0.1
      "https://0x7f000001/", // hex 127.0.0.1
    ]) {
      expect(isSafePushEndpoint(bad), bad).toBe(false);
    }
  });

  it("blocks non-https and internal hostnames", () => {
    for (const bad of [
      "http://fcm.googleapis.com/x", // plaintext
      "https://localhost/x",
      "https://metadata/x", // single-label
      "https://cache.internal/x",
      "https://foo.local/x",
      "ftp://fcm.googleapis.com/x",
      "not a url",
      "",
    ]) {
      expect(isSafePushEndpoint(bad), bad).toBe(false);
    }
  });
});

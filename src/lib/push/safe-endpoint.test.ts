import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mocks.lookup(...args),
}));

import { isSafePushEndpoint, isSafePushEndpointResolved } from "./safe-endpoint";

beforeEach(() => {
  vi.clearAllMocks();
});

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
      "https://localhost./x", // trailing FQDN root dot — must not bypass
      "https://metadata/x", // single-label
      "https://cache.internal/x",
      "https://cache.internal./x", // trailing-dot bypass of the suffix check
      "https://foo.local/x",
      "ftp://fcm.googleapis.com/x",
      "not a url",
      "",
    ]) {
      expect(isSafePushEndpoint(bad), bad).toBe(false);
    }
  });

  it("blocks public hostnames that resolve to private IPs", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    await expect(isSafePushEndpointResolved("https://push.example.com/sub")).resolves.toBe(false);
  });

  it("blocks public hostnames that resolve to IPv6 ULA addresses", async () => {
    mocks.lookup.mockResolvedValue([{ address: "fd00::1", family: 6 }]);

    await expect(isSafePushEndpointResolved("https://push.example.com/sub")).resolves.toBe(false);
  });

  it("treats DNS failures or empty answers as unsafe", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("dns down"));
    await expect(isSafePushEndpointResolved("https://push.example.com/sub")).resolves.toBe(false);

    mocks.lookup.mockResolvedValueOnce([]);
    await expect(isSafePushEndpointResolved("https://push.example.com/sub")).resolves.toBe(false);
  });

  it("allows public hostnames when every DNS answer is public", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);

    await expect(isSafePushEndpointResolved("https://push.example.com/sub")).resolves.toBe(true);
  });
});

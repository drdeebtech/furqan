/**
 * getClientIp trust model (issue #691): forwarding headers are only
 * authoritative when a trusted proxy set them. On Vercel the edge overwrites
 * them; anywhere else they are client-controlled bytes unless the deployment
 * explicitly declares its trusted-proxy hop count.
 *
 * Table-driven: each case is (env, headers) → expected IP. The `env` param
 * is injected so tests don't mutate process.env.
 */
import { describe, expect, it } from "vitest";

import { getClientIp } from "./client-ip";

function h(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

describe("getClientIp (#691 trusted-proxy model)", () => {
  it.each([
    ["x-forwarded-for leftmost entry", { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }, "203.0.113.7"],
    ["x-real-ip fallback", { "x-real-ip": "203.0.113.8" }, "203.0.113.8"],
    ["no headers", {}, null],
  ])("on Vercel, headers are authoritative: %s", (_name, headers, expected) => {
    expect(getClientIp(h(headers as Record<string, string>), { VERCEL: "1" })).toBe(expected);
  });

  it("off Vercel with no trusted-proxy config, a spoofed x-forwarded-for yields no IP", () => {
    // Untrusted peer: the header is attacker-controlled — using it would let
    // one client mint unlimited fresh per-IP rate-limit buckets.
    expect(getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), {})).toBeNull();
  });

  it("off Vercel with TRUSTED_PROXY_HOPS=1, the entry appended by the trusted proxy wins — spoofed prefix ignored", () => {
    // Client sent "x-forwarded-for: 6.6.6.6" (spoof); the one trusted proxy
    // appended the real socket address. Counting hops from the right is the
    // only spoof-proof way to read the chain.
    const headers = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(getClientIp(headers, { TRUSTED_PROXY_HOPS: "1" })).toBe("203.0.113.7");
  });

  it.each([
    ["2 hops → second entry from the right", "6.6.6.6, 203.0.113.7, 10.0.0.5", "2", "203.0.113.7"],
    ["chain shorter than declared hops", "203.0.113.7", "2", null],
    ["hops = 0 is not a trust grant", "203.0.113.7", "0", null],
    ["hops garbage value", "203.0.113.7", "abc", null],
    ["negative hops", "203.0.113.7", "-1", null],
  ])("trusted-hop edge: %s", (_name, xff, hops, expected) => {
    const result = getClientIp(h({ "x-forwarded-for": xff }), { TRUSTED_PROXY_HOPS: hops });
    expect(result).toBe(expected);
  });
});

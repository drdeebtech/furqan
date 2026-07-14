import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockLogError = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit (issue #688 — atomic + fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the atomic RPC with the workflow bucket, key, cap, and 1h window", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const allowed = await checkRateLimit("1.2.3.4", "login-attempt-ip", 50);

    expect(allowed).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("check_and_increment_rate_limit", {
      p_bucket: "login-attempt-ip",
      p_identifier: "1.2.3.4",
      p_max: 50,
      p_window_seconds: 3600,
    });
  });

  it("denies when the RPC reports the cap is exceeded", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    expect(await checkRateLimit("1.2.3.4", "login-attempt-ip", 50)).toBe(false);
  });

  it("denies on a non-boolean RPC payload (never admits on unknown state)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    expect(await checkRateLimit("1.2.3.4", "login-attempt-ip", 50)).toBe(false);
  });

  it("fail-closed: denies when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });

    const allowed = await checkRateLimit("1.2.3.4", "login-attempt-ip", 50, {
      failClosed: true,
    });

    expect(allowed).toBe(false);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("fail-closed: denies when the RPC call throws", async () => {
    mockRpc.mockRejectedValue(new Error("network"));

    const allowed = await checkRateLimit("1.2.3.4", "login-attempt-ip", 50, {
      failClosed: true,
    });

    expect(allowed).toBe(false);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("default (public forms) stays fail-open on limiter error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });

    expect(await checkRateLimit("1.2.3.4", "contact-attempt", 5)).toBe(true);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("default (public forms) stays fail-open when the RPC call throws", async () => {
    mockRpc.mockRejectedValue(new Error("network"));

    expect(await checkRateLimit("1.2.3.4", "contact-attempt", 5)).toBe(true);
  });
});

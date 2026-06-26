import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logWarn: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: mocks.setVapidDetails },
}));
vi.mock("@/lib/logger", () => ({
  logWarn: (...args: unknown[]) => mocks.logWarn(...args),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  vi.stubEnv("VAPID_SUBJECT", "mailto:support@furqan.today");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VAPID configuration", () => {
  it("configures web-push once at module load", async () => {
    const { configuredWebpush } = await import("./vapid");

    expect(configuredWebpush).not.toBeNull();
    expect(mocks.setVapidDetails).toHaveBeenCalledOnce();
    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      "mailto:support@furqan.today",
      "public-key",
      "private-key",
    );
  });

  it("fails soft and logs once when a VAPID key is missing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");

    const { configuredWebpush } = await import("./vapid");

    expect(configuredWebpush).toBeNull();
    expect(mocks.setVapidDetails).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });

  it("never throws at import when web-push rejects invalid configuration", async () => {
    mocks.setVapidDetails.mockImplementation(() => {
      throw new Error("invalid configuration");
    });

    await expect(import("./vapid")).resolves.toMatchObject({
      configuredWebpush: null,
    });
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });
});

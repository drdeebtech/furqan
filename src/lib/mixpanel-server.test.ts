import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { MIXPANEL_EVENTS, trackMixpanel } from "./mixpanel-server";

const mockFetch = vi.fn();

describe("trackMixpanel (fail-soft server-side ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("NEXT_PUBLIC_MIXPANEL_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the event with token, distinct_id, and properties to the ingestion API", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await trackMixpanel("user-1", MIXPANEL_EVENTS.BOOKING_CONFIRMED, {
      session_type: "hifz",
      duration_min: 60,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mixpanel.com/track?ip=0");
    const [payload] = JSON.parse(String(init.body));
    expect(payload.event).toBe("booking_confirmed");
    expect(payload.properties).toMatchObject({
      token: "test-token",
      distinct_id: "user-1",
      session_type: "hifz",
      duration_min: 60,
    });
    expect(payload.properties.$insert_id).toBeTruthy();
  });

  it("no token → no network call, no error", async () => {
    vi.stubEnv("NEXT_PUBLIC_MIXPANEL_TOKEN", "");

    await trackMixpanel("user-1", MIXPANEL_EVENTS.SIGN_UP_COMPLETED);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("a rejecting fetch never throws into the caller (auth/booking flows must not break)", async () => {
    mockFetch.mockRejectedValue(new Error("ingest down"));

    await expect(
      trackMixpanel("user-1", MIXPANEL_EVENTS.SIGN_UP_COMPLETED, { method: "email" }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
  });

  it("the hung request itself is aborted at the timeout boundary (real timers)", async () => {
    // Real timers on purpose: AbortSignal.timeout() runs on Node-internal
    // timers that vitest's fake timers do not fake — advancing fake time
    // would never fire the abort. Costs ~2s wall time, guards the actual
    // cancellation (withTimeout alone only stops waiting).
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise(() => {}); // never settles
    });

    await expect(
      trackMixpanel("user-1", MIXPANEL_EVENTS.SIGN_UP_COMPLETED),
    ).resolves.toBeUndefined();
    expect(capturedSignal).toBeDefined();
    // The race and the abort share the same deadline; allow a tick of jitter.
    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true), { timeout: 1000 });
  }, 10_000);

  it("a hung fetch resolves within the timeout bound instead of stalling the action", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockReturnValue(new Promise(() => {}));
      const pending = trackMixpanel("user-1", MIXPANEL_EVENTS.SIGN_UP_COMPLETED);
      await vi.advanceTimersByTimeAsync(2001);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

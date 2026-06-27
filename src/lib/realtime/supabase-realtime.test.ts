import { describe, it, expect, vi, beforeEach } from "vitest";
import { isRealtimeConfigured, subscribeToUserNotifications } from "./supabase-realtime";

// ── Supabase client mock ─────────────────────────────────────────────────────

const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
const mockSubscribe = vi.fn();
const mockOn = vi.fn();
const mockChannel = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: mockChannel,
    removeChannel: mockUnsubscribe,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Wire up fluent chain: channel().on().subscribe()
  mockSubscribe.mockReturnValue({ unsubscribe: vi.fn() });
  mockOn.mockReturnValue({ subscribe: mockSubscribe });
  mockChannel.mockReturnValue({ on: mockOn });
});

// ── isRealtimeConfigured ─────────────────────────────────────────────────────

describe("isRealtimeConfigured", () => {
  it("returns true when both env vars are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(isRealtimeConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("returns false when URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(isRealtimeConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false when anon key is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isRealtimeConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });
});

// ── subscribeToUserNotifications ─────────────────────────────────────────────

describe("subscribeToUserNotifications", () => {
  it("returns a no-op unsubscribe when unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const onInsert = vi.fn();
    const unsubscribe = subscribeToUserNotifications("user-1", onInsert);

    expect(mockChannel).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();

    vi.unstubAllEnvs();
  });

  it("creates a channel with the correct filter when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    subscribeToUserNotifications("user-abc", vi.fn());

    expect(mockChannel).toHaveBeenCalledWith("user-notifications:user-abc");
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: "user_id=eq.user-abc",
      }),
      expect.any(Function),
    );
    expect(mockSubscribe).toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it("calls onInsert when the postgres_changes callback fires", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const onInsert = vi.fn();
    subscribeToUserNotifications("user-abc", onInsert);

    // Extract the callback passed to .on()
    const insertCallback = mockOn.mock.calls[0][2] as () => void;
    insertCallback();

    expect(onInsert).toHaveBeenCalledOnce();

    vi.unstubAllEnvs();
  });

  it("does not throw when onInsert throws — logs instead", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const { logError } = await import("@/lib/logger");
    const onInsert = vi.fn().mockImplementation(() => { throw new Error("boom"); });

    subscribeToUserNotifications("user-abc", onInsert);
    const insertCallback = mockOn.mock.calls[0][2] as () => void;

    expect(() => insertCallback()).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      "realtime notification callback failed",
      expect.any(Error),
      expect.objectContaining({ tag: "realtime" }),
    );

    vi.unstubAllEnvs();
  });

  it("calls removeChannel on unsubscribe", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const unsubscribe = subscribeToUserNotifications("user-abc", vi.fn());
    unsubscribe();

    expect(mockUnsubscribe).toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});

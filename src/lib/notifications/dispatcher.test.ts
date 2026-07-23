import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.mock factories are hoisted above imports, so any variables they close over
// must be declared with vi.hoisted() to be available at hoist time.
const { mockInsert, mockMaybeSingle, mockFrom, mockLogError, mockIsInQuietHours, mockCreateAdminClient } = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockFrom = vi.fn();
  const mockLogError = vi.fn();
  const mockIsInQuietHours = vi.fn();
  const mockCreateAdminClient = vi.fn();
  return { mockInsert, mockMaybeSingle, mockFrom, mockLogError, mockIsInQuietHours, mockCreateAdminClient };
});

// ─── Mock next/server ────────────────────────────────────────────────────────
// after() is observability-only; do not execute the callback in tests.
vi.mock("next/server", () => ({ after: vi.fn() }));

// ─── Supabase chainable mock ─────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

// Set up default return value for createAdminClient
mockCreateAdminClient.mockReturnValue({ from: mockFrom });

// ─── Logger mock ─────────────────────────────────────────────────────────────
vi.mock("@/lib/logger", () => ({ logError: mockLogError }));

// ─── Quiet hours mock ────────────────────────────────────────────────────────
vi.mock("./dispatcher-quiet-hours", () => ({ isInQuietHours: mockIsInQuietHours }));

// ─── Subject under test ───────────────────────────────────────────────────────
import { notify } from "./dispatcher";
import type { NotifyOptions } from "./dispatcher";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** A minimal valid NotifyOptions for tests that don't care about the specifics. */
const BASE_OPTS: NotifyOptions = {
  userId: "user-abc",
  type: "system",
  title: "الدرس مكتمل",
};

/** Build a full prefs row with permissive defaults. */
function makePrefs(overrides: Partial<{
  in_app_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  important_only_mode: boolean;
}> = {}) {
  return {
    in_app_enabled: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    important_only_mode: false,
    ...overrides,
  };
}

/** Wire mockFrom so that:
 *  - from("communication_preferences") resolves via maybeSingle
 *  - from("notifications") / from("message_delivery_log") resolves via insert
 */
function setupFrom(
  prefsData: ReturnType<typeof makePrefs> | null,
  insertResult: { error: null | { message: string } } = { error: null },
) {
  mockInsert.mockResolvedValue(insertResult);
  mockMaybeSingle.mockResolvedValue({ data: prefsData });

  mockFrom.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    returns: vi.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
    insert: mockInsert,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsInQuietHours.mockReturnValue(false);
  mockCreateAdminClient.mockReturnValue({ from: mockFrom });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notify — important_only_mode", () => {
  it("skips insert when importantOnly=true and urgent=false", async () => {
    setupFrom(makePrefs({ important_only_mode: true }));

    await notify({ ...BASE_OPTS, urgent: false });

    // The "notifications" table insert must not have been called
    expect(mockFrom).not.toHaveBeenCalledWith("notifications");
    expect(mockInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });

  it("allows insert when importantOnly=true and urgent=true", async () => {
    setupFrom(makePrefs({ important_only_mode: true }));

    await notify({ ...BASE_OPTS, urgent: true });

    expect(mockFrom).toHaveBeenCalledWith("notifications");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });
});

describe("notify — quiet hours", () => {
  it("skips insert when isInQuietHours returns true and urgent=false", async () => {
    setupFrom(makePrefs({ quiet_hours_start: "22:00", quiet_hours_end: "06:00" }));
    mockIsInQuietHours.mockReturnValue(true);

    await notify({ ...BASE_OPTS, urgent: false });

    expect(mockFrom).not.toHaveBeenCalledWith("notifications");
    expect(mockInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });

  it("allows insert when isInQuietHours returns true but urgent=true", async () => {
    setupFrom(makePrefs({ quiet_hours_start: "22:00", quiet_hours_end: "06:00" }));
    mockIsInQuietHours.mockReturnValue(true);

    await notify({ ...BASE_OPTS, urgent: true });

    expect(mockFrom).toHaveBeenCalledWith("notifications");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });

  it("does not call isInQuietHours when quiet_hours_start is null", async () => {
    setupFrom(makePrefs({ quiet_hours_start: null, quiet_hours_end: "06:00" }));

    await notify(BASE_OPTS);

    expect(mockIsInQuietHours).not.toHaveBeenCalled();
  });
});

describe("notify — in_app_enabled flag", () => {
  it("skips notifications insert when in_app_enabled=false", async () => {
    setupFrom(makePrefs({ in_app_enabled: false }));

    await notify(BASE_OPTS);

    expect(mockFrom).not.toHaveBeenCalledWith("notifications");
    expect(mockInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });

  it("calls notifications insert when in_app_enabled=true", async () => {
    setupFrom(makePrefs({ in_app_enabled: true }));

    await notify(BASE_OPTS);

    expect(mockFrom).toHaveBeenCalledWith("notifications");
  });
});

describe("notify — insert payload", () => {
  it("inserts into 'notifications', not 'message_delivery_log'", async () => {
    setupFrom(makePrefs());

    await notify(BASE_OPTS);

    const calledTables = mockFrom.mock.calls.map(([t]) => t as string);
    expect(calledTables).toContain("notifications");
    expect(calledTables).not.toContain("message_delivery_log");
  });

  it("insert payload contains user_id, type, title, body, and channel=['in_app']", async () => {
    setupFrom(makePrefs());

    await notify({ ...BASE_OPTS, body: "تفاصيل الدرس" });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-abc",
        type: "system",
        title: "الدرس مكتمل",
        body: "تفاصيل الدرس",
        channel: ["in_app"],
      }),
    );
  });

  it("sets body to null when body is omitted", async () => {
    setupFrom(makePrefs());

    await notify(BASE_OPTS);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ body: null }),
    );
  });

  it("sets data to null when data is omitted", async () => {
    setupFrom(makePrefs());

    await notify(BASE_OPTS);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ data: null }),
    );
  });

  it("passes data field through when provided", async () => {
    setupFrom(makePrefs());
    const extraData = { lessonId: "lesson-1", score: 95 };

    await notify({ ...BASE_OPTS, data: extraData });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ data: extraData }),
    );
  });
});

describe("notify — missing prefs row (null)", () => {
  it("defaults to inAppEnabled=true and importantOnly=false → insert happens", async () => {
    // maybeSingle returns null → no prefs row for this user
    setupFrom(null);

    await notify(BASE_OPTS);

    expect(mockFrom).toHaveBeenCalledWith("notifications");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: BASE_OPTS.userId }),
    );
  });

  it("does not apply quiet-hours check when prefs row is null", async () => {
    setupFrom(null);

    await notify(BASE_OPTS);

    // quiet_hours_start / quiet_hours_end are absent on a null row — guard skips isInQuietHours
    expect(mockIsInQuietHours).not.toHaveBeenCalled();
  });
});

describe("notify — insert failure", () => {
  it("calls logError with 'notify: notifications insert failed' on insert error", async () => {
    const dbError = { message: "unique constraint violation" };
    setupFrom(makePrefs(), { error: dbError });

    await notify(BASE_OPTS);

    expect(mockLogError).toHaveBeenCalledWith(
      "notify: notifications insert failed",
      dbError,
      expect.objectContaining({ tag: "dispatcher" }),
    );
  });

  it("does not throw when the notifications insert fails", async () => {
    setupFrom(makePrefs(), { error: { message: "db error" } });

    await expect(notify(BASE_OPTS)).resolves.toBeUndefined();
  });
});

describe("notify — return value", () => {
  it("resolves to void (undefined) on success", async () => {
    setupFrom(makePrefs());

    const result = await notify(BASE_OPTS);

    expect(result).toBeUndefined();
  });

  it("resolves to void when insert is skipped (in_app_enabled=false)", async () => {
    setupFrom(makePrefs({ in_app_enabled: false }));

    const result = await notify(BASE_OPTS);

    expect(result).toBeUndefined();
  });
});

describe("notify — optional fields", () => {
  it("works when body and data are both omitted", async () => {
    setupFrom(makePrefs());

    await expect(
      notify({ userId: "u1", type: "booking", title: "تم الحجز" }),
    ).resolves.toBeUndefined();
  });

  it("works when entityType, entityId, and templateName are all omitted", async () => {
    setupFrom(makePrefs());

    await expect(
      notify({ userId: "u1", type: "payment", title: "تم الدفع" }),
    ).resolves.toBeUndefined();
  });
});

describe("notify never-throw contract", () => {
  it("resolves (not rejects) when createAdminClient throws", async () => {
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    });
    await expect(
      notify({ userId: "u1", type: "system", title: "t" }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      "notify: dispatch failed",
      expect.any(Error),
      expect.objectContaining({ tag: "dispatcher" }),
    );
  });

  it("resolves when the preferences read rejects", async () => {
    // Wire the from() chain first so the test exercises the real path
    setupFrom(null);
    // Now make maybeSingle reject with a network error
    mockMaybeSingle.mockRejectedValue(new Error("Network timeout"));
    await expect(
      notify({ userId: "u1", type: "system", title: "t" }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      "notify: dispatch failed",
      expect.any(Error),
      expect.objectContaining({ tag: "dispatcher" }),
    );
  });
});

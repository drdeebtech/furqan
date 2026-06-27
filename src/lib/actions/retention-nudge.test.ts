import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const mockIsFeatureEnabled = vi.fn();
vi.mock("@/lib/settings", () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const mockNotify = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (...a: unknown[]) => mockNotify(...a),
}));

const mockIsInQuietHours = vi.fn().mockReturnValue(false);
vi.mock("@/lib/notifications/dispatcher-quiet-hours", () => ({
  isInQuietHours: (...a: unknown[]) => mockIsInQuietHours(...a),
}));

const mockSendPush = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
vi.mock("@/lib/push/send", () => ({
  sendPushToUser: (...a: unknown[]) => mockSendPush(...a),
}));

const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: (...a: unknown[]) => mockEmitEvent(...a),
}));

import {
  shouldNudge,
  buildNudgeCopy,
  runReengagementNudge,
  nudgeOneStudent,
  REENGAGE_DETECTION,
} from "./retention-nudge";

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-01T12:00:00Z");
const MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS).toISOString();
// runReengagementNudge uses real `new Date()` internally, so detection-page
// fixtures must be relative to the wall clock, not the fixed NOW above.
const realDaysAgo = (n: number) => new Date(Date.now() - n * MS).toISOString();

type Result = { data?: unknown; error?: unknown };

/**
 * Chainable PostgREST builder stub. `then` makes it awaitable (resolves to
 * `selectResult`); `.eq()` after `.update()` resolves to `updateResult`;
 * `.maybeSingle()` resolves to `singleResult`; `.insert()` resolves to
 * `insertResult`. Covers every call shape retention-nudge.ts uses.
 */
function builder(opts: {
  selectResult?: Result;
  singleResult?: Result;
  updateResult?: Result;
  insertResult?: Result;
}) {
  let isUpdate = false;
  const b: Record<string, unknown> = {
    select: () => b,
    update: () => {
      isUpdate = true;
      return b;
    },
    insert: () => Promise.resolve(opts.insertResult ?? { error: null }),
    lt: () => b,
    gte: () => b,
    order: () => b,
    range: () => b,
    returns: () => b,
    eq: () => (isUpdate ? Promise.resolve(opts.updateResult ?? { error: null }) : b),
    maybeSingle: () => Promise.resolve(opts.singleResult ?? { data: null }),
    then: (resolve: (v: Result) => unknown) =>
      resolve(opts.selectResult ?? { data: [], error: null }),
  };
  return b;
}

const permissivePrefs = {
  in_app_enabled: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  important_only_mode: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsInQuietHours.mockReturnValue(false);
});

// ── shouldNudge ──────────────────────────────────────────────────────────────

describe("shouldNudge", () => {
  it("returns false for null lastSessionAt", () => {
    expect(shouldNudge(null, null, NOW)).toBe(false);
  });
  it("returns false for an unparseable lastSessionAt", () => {
    expect(shouldNudge("not-a-date", null, NOW)).toBe(false);
  });
  it("excludes a student lapsed exactly 7 days (boundary)", () => {
    expect(shouldNudge(daysAgo(7), null, NOW)).toBe(false);
  });
  it("includes a student lapsed 8 days (over threshold, under cap)", () => {
    expect(shouldNudge(daysAgo(8), null, NOW)).toBe(true);
  });
  it("excludes a student lapsed more than 60 days (churned)", () => {
    expect(shouldNudge(daysAgo(61), null, NOW)).toBe(false);
  });
  it("excludes when within 14-day cooldown", () => {
    expect(shouldNudge(daysAgo(10), daysAgo(5), NOW)).toBe(false);
  });
  it("includes when cooldown has expired", () => {
    expect(shouldNudge(daysAgo(10), daysAgo(15), NOW)).toBe(true);
  });
  it("includes when last_intervention_at is unparseable (no cooldown applied)", () => {
    expect(shouldNudge(daysAgo(10), "garbage", NOW)).toBe(true);
  });
  it("includes when last_intervention_at is null", () => {
    expect(shouldNudge(daysAgo(10), null, NOW)).toBe(true);
  });
  it("exposes named constants", () => {
    expect(REENGAGE_DETECTION).toEqual({ lapsedDays: 7, cooldownDays: 14, capDays: 60 });
  });
});

// ── buildNudgeCopy ───────────────────────────────────────────────────────────

describe("buildNudgeCopy", () => {
  it("generic fallback when progress is null", () => {
    expect(buildNudgeCopy(null).body).not.toContain("آية");
  });
  it("uses canonical surah name from surahs.ts (Al-Fatiha)", () => {
    const copy = buildNudgeCopy({ surah_to: 1, ayah_to: 3 });
    expect(copy.body).toContain("الفاتحة");
    expect(copy.body).toContain("3");
  });
  it("uses canonical name for surah 2 (Al-Baqarah)", () => {
    expect(buildNudgeCopy({ surah_to: 2, ayah_to: 255 }).body).toContain("البقرة");
  });
  it("defaults ayah to 1 when ayah_to is null but surah valid", () => {
    const copy = buildNudgeCopy({ surah_to: 1, ayah_to: null });
    expect(copy.body).toContain("الفاتحة");
    expect(copy.body).toContain("1");
  });
  it("generic fallback when surah_to is null", () => {
    expect(buildNudgeCopy({ surah_to: null, ayah_to: null }).body).not.toContain("آية");
  });
  it("generic fallback when surah_to out of range (0)", () => {
    expect(buildNudgeCopy({ surah_to: 0, ayah_to: 1 }).body).not.toContain("آية");
  });
  it("generic fallback when surah_to out of range (115)", () => {
    expect(buildNudgeCopy({ surah_to: 115, ayah_to: 1 }).body).not.toContain("آية");
  });
});

// ── nudgeOneStudent ──────────────────────────────────────────────────────────

describe("nudgeOneStudent", () => {
  function adminFor(prefs: unknown, progress: unknown, updateResult: Result = { error: null }) {
    return {
      from: (table: string) => {
        if (table === "student_progress") return builder({ singleResult: { data: progress } });
        if (table === "communication_preferences") return builder({ singleResult: { data: prefs } });
        if (table === "retention_signals") return builder({ updateResult });
        return builder({});
      },
    } as never;
  }

  it("fires in-app + push + event and stamps when prefs permit", async () => {
    const admin = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 });
    await nudgeOneStudent(admin, "stu-1", NOW);
    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockSendPush).toHaveBeenCalledOnce();
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "retention.intervention_triggered",
      "student",
      "stu-1",
      { intervention_type: "reengagement_7d" },
      null,
    );
  });

  it("falls back to generic copy when no progress row", async () => {
    const admin = adminFor(permissivePrefs, null);
    await nudgeOneStudent(admin, "stu-2", NOW);
    const arg = mockNotify.mock.calls[0][0] as { body: string };
    expect(arg.body).not.toContain("آية");
  });

  it("skips both channels in quiet hours but still stamps", async () => {
    mockIsInQuietHours.mockReturnValue(true);
    const admin = adminFor(
      { ...permissivePrefs, quiet_hours_start: "22:00", quiet_hours_end: "06:00" },
      { surah_to: 1, ayah_to: 3 },
    );
    await nudgeOneStudent(admin, "stu-3", NOW);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockEmitEvent).toHaveBeenCalledOnce();
  });

  it("skips both channels in important-only mode", async () => {
    const admin = adminFor({ ...permissivePrefs, important_only_mode: true }, { surah_to: 1, ayah_to: 3 });
    await nudgeOneStudent(admin, "stu-4", NOW);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips both channels when in_app disabled", async () => {
    const admin = adminFor({ ...permissivePrefs, in_app_enabled: false }, { surah_to: 1, ayah_to: 3 });
    await nudgeOneStudent(admin, "stu-5", NOW);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("uses permissive defaults when no prefs row exists", async () => {
    const admin = adminFor(null, { surah_to: 1, ayah_to: 3 });
    await nudgeOneStudent(admin, "stu-6", NOW);
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it("throws when the cooldown stamp fails", async () => {
    const admin = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 }, { error: { message: "boom" } });
    await expect(nudgeOneStudent(admin, "stu-7", NOW)).rejects.toThrow(/stamp failed for stu-7/);
  });
});

// ── runReengagementNudge — gating ────────────────────────────────────────────

describe("runReengagementNudge — gating off", () => {
  it("no-ops when automation_enabled is false", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    expect(await runReengagementNudge()).toEqual({ detected: 0, nudged: 0, skipped: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it("no-ops when retention_automation_enabled is false", async () => {
    mockIsFeatureEnabled.mockImplementation((k: string) =>
      Promise.resolve(k !== "retention_automation_enabled"),
    );
    expect(await runReengagementNudge()).toEqual({ detected: 0, nudged: 0, skipped: 0 });
  });
});

// ── runReengagementNudge — batch ─────────────────────────────────────────────

describe("runReengagementNudge — batch", () => {
  beforeEach(() => {
    mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it("empty detection writes a succeeded completion marker and returns zeros", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "automation_logs") return { insert };
      return builder({ selectResult: { data: [], error: null } });
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 0, nudged: 0, skipped: 0 });
    expect(insert).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0][0] as { status: string }).status).toBe("succeeded");
  });

  it("happy path detects one lapsed student, nudges, writes succeeded marker", async () => {
    const page = [{ student_id: "s1", last_session_at: realDaysAgo(8), last_intervention_at: null }];
    let detectionCalls = 0;
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "automation_logs") return { insert };
      if (table === "student_progress")
        return builder({ singleResult: { data: { surah_to: 1, ayah_to: 3 } } });
      if (table === "communication_preferences")
        return builder({ singleResult: { data: permissivePrefs } });
      if (table === "retention_signals") {
        detectionCalls += 1;
        // First call = detection select (one short page → loop breaks).
        // Subsequent call = the stamp update.
        if (detectionCalls === 1) return builder({ selectResult: { data: page, error: null } });
        return builder({ updateResult: { error: null } });
      }
      return builder({});
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 1, nudged: 1, skipped: 0 });
    expect(mockNotify).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0][0] as { status: string }).status).toBe("succeeded");
  });

  it("counts a student as skipped and marks succeeded_with_skips when dispatch throws", async () => {
    const page = [{ student_id: "s1", last_session_at: realDaysAgo(8), last_intervention_at: null }];
    let detectionCalls = 0;
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "automation_logs") return { insert };
      if (table === "student_progress") return builder({ singleResult: { data: null } });
      if (table === "communication_preferences")
        return builder({ singleResult: { data: permissivePrefs } });
      if (table === "retention_signals") {
        detectionCalls += 1;
        if (detectionCalls === 1) return builder({ selectResult: { data: page, error: null } });
        return builder({ updateResult: { error: { message: "stamp boom" } } });
      }
      return builder({});
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 1, nudged: 0, skipped: 1 });
    expect(mockLogError).toHaveBeenCalled();
    expect((insert.mock.calls[0][0] as { status: string }).status).toBe("succeeded_with_skips");
  });

  it("throws when the detection query errors", async () => {
    mockFrom.mockImplementation(() =>
      builder({ selectResult: { data: null, error: { message: "db down" } } }),
    );
    await expect(runReengagementNudge()).rejects.toThrow("db down");
  });

  it("logs (does not throw) when the completion-marker insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "log insert failed" } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "automation_logs") return { insert };
      return builder({ selectResult: { data: [], error: null } });
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 0, nudged: 0, skipped: 0 });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("completion marker"),
      expect.anything(),
      expect.anything(),
    );
  });
});

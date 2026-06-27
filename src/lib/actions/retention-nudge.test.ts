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
 * Chainable PostgREST builder stub covering every call shape retention-nudge.ts
 * uses:
 *  - detection: `.select().lte().gte().order().range().returns()` then awaited
 *    → resolves to `selectResult` via `then`.
 *  - prefs/progress: `.select().eq()….maybeSingle()` → resolves `singleResult`.
 *  - atomic claim: `.update().eq().or().select()` → the `.select()` after
 *    `.update()` is the awaited terminal, resolving `claimResult`.
 *  - completion marker: `.insert()` → resolves `insertResult`.
 */
function builder(opts: {
  selectResult?: Result;
  singleResult?: Result;
  claimResult?: Result;
  insertResult?: Result;
  onUpdate?: () => void;
}) {
  let isUpdate = false;
  const b: Record<string, unknown> = {
    select: () =>
      isUpdate ? Promise.resolve(opts.claimResult ?? { data: [], error: null }) : b,
    update: () => {
      isUpdate = true;
      opts.onUpdate?.();
      return b;
    },
    insert: () => Promise.resolve(opts.insertResult ?? { error: null }),
    lt: () => b,
    lte: () => b,
    gte: () => b,
    or: () => b,
    order: () => b,
    range: () => b,
    returns: () => b,
    eq: () => b,
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
  it("includes a student lapsed exactly 7 days (inclusive boundary: 7+ days)", () => {
    expect(shouldNudge(daysAgo(7), null, NOW)).toBe(true);
  });
  it("excludes a student lapsed under 7 days (6 days, just-under boundary)", () => {
    expect(shouldNudge(daysAgo(6), null, NOW)).toBe(false);
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
  it("names the surah only (no ayah claim) when ayah_to is null — never overstate progress", () => {
    const copy = buildNudgeCopy({ surah_to: 1, ayah_to: null });
    expect(copy.body).toContain("الفاتحة");
    // Must NOT claim a specific ayah when none is recorded (AGENTS.md §2).
    expect(copy.body).not.toContain("آية");
    expect(copy.body).not.toContain("آية 1");
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
  const CUTOFF = realDaysAgo(14); // cooldown cutoff ISO passed by the caller

  function adminFor(
    prefs: unknown,
    progress: unknown,
    claim: { rows?: unknown[]; error?: unknown } = {},
  ) {
    const updateSpy = vi.fn();
    const admin = {
      from: (table: string) => {
        if (table === "student_progress") return builder({ singleResult: { data: progress } });
        if (table === "communication_preferences") return builder({ singleResult: { data: prefs } });
        if (table === "retention_signals")
          return builder({
            claimResult: { data: claim.rows ?? [{ student_id: "x" }], error: claim.error ?? null },
            onUpdate: updateSpy,
          });
        return builder({});
      },
    } as never;
    return { admin, updateSpy };
  }

  it("claims, fires in-app + push + event, returns true when prefs permit and claim wins", async () => {
    const { admin } = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 });
    const result = await nudgeOneStudent(admin, "stu-1", CUTOFF);
    expect(result).toBe(true);
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
    const { admin } = adminFor(permissivePrefs, null);
    await nudgeOneStudent(admin, "stu-2", CUTOFF);
    const arg = mockNotify.mock.calls[0][0] as { body: string };
    expect(arg.body).not.toContain("آية");
  });

  it("returns false WITHOUT claiming/emitting/dispatching in quiet hours", async () => {
    mockIsInQuietHours.mockReturnValue(true);
    const { admin, updateSpy } = adminFor(
      { ...permissivePrefs, quiet_hours_start: "22:00", quiet_hours_end: "06:00" },
      { surah_to: 1, ayah_to: 3 },
    );
    const result = await nudgeOneStudent(admin, "stu-3", CUTOFF);
    expect(result).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled(); // never stamps when nothing sent
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("returns false WITHOUT claiming in important-only mode", async () => {
    const { admin, updateSpy } = adminFor(
      { ...permissivePrefs, important_only_mode: true },
      { surah_to: 1, ayah_to: 3 },
    );
    const result = await nudgeOneStudent(admin, "stu-4", CUTOFF);
    expect(result).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("returns false WITHOUT claiming when in_app disabled", async () => {
    const { admin, updateSpy } = adminFor(
      { ...permissivePrefs, in_app_enabled: false },
      { surah_to: 1, ayah_to: 3 },
    );
    const result = await nudgeOneStudent(admin, "stu-5", CUTOFF);
    expect(result).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("uses permissive defaults when no prefs row exists", async () => {
    const { admin } = adminFor(null, { surah_to: 1, ayah_to: 3 });
    const result = await nudgeOneStudent(admin, "stu-6", CUTOFF);
    expect(result).toBe(true);
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it("returns false and does NOT dispatch when the claim wins zero rows (lost race / in cooldown)", async () => {
    const { admin } = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 }, { rows: [] });
    const result = await nudgeOneStudent(admin, "stu-7", CUTOFF);
    expect(result).toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("throws when the claim update errors", async () => {
    const { admin } = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 }, { error: { message: "boom" } });
    await expect(nudgeOneStudent(admin, "stu-8", CUTOFF)).rejects.toThrow(/claim failed for stu-8/);
  });

  it("still returns true (claim holds) but logs when notify throws after a successful claim", async () => {
    mockNotify.mockRejectedValueOnce(new Error("notify down"));
    const { admin } = adminFor(permissivePrefs, { surah_to: 1, ayah_to: 3 });
    const result = await nudgeOneStudent(admin, "stu-9", CUTOFF);
    expect(result).toBe(true);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("dispatch failed after claim"),
      expect.anything(),
      expect.anything(),
    );
    expect(mockEmitEvent).toHaveBeenCalledOnce(); // event still emitted post-claim
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
        // Subsequent call = the atomic claim (update→select returns the row).
        if (detectionCalls === 1) return builder({ selectResult: { data: page, error: null } });
        return builder({ claimResult: { data: [{ student_id: "s1" }], error: null } });
      }
      return builder({});
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 1, nudged: 1, skipped: 0 });
    expect(mockNotify).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0][0] as { status: string }).status).toBe("succeeded");
  });

  it("counts a student as skipped and marks succeeded_with_skips when the claim errors", async () => {
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
        return builder({ claimResult: { data: null, error: { message: "claim boom" } } });
      }
      return builder({});
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 1, nudged: 0, skipped: 1 });
    expect(mockLogError).toHaveBeenCalled();
    expect((insert.mock.calls[0][0] as { status: string }).status).toBe("succeeded_with_skips");
  });

  it("counts a student as skipped (clean, no throw) when the claim wins zero rows", async () => {
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
        return builder({ claimResult: { data: [], error: null } }); // lost the race
      }
      return builder({});
    });
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 1, nudged: 0, skipped: 1 });
    expect(mockNotify).not.toHaveBeenCalled();
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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockResolvedValue(undefined),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("@/lib/notifications/dispatcher", () => ({ notify: mocks.notify }));

import { awardAchievement } from "./award";
import { BADGE_CATALOG, type AchievementType } from "./catalog";

function makeAdmin(insertResult: { error: { code?: string; message?: string } | null }) {
  mocks.insert.mockResolvedValue(insertResult);
  mocks.createAdminClient.mockReturnValue({
    from: () => ({ insert: mocks.insert }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emitEvent.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
});

describe("awardAchievement", () => {
  it("inserts, emits, and notifies on the first call", async () => {
    makeAdmin({ error: null });

    const result = await awardAchievement("student-1", "first_session");

    expect(result).toEqual({ awarded: true });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: "student-1", type: "first_session" }),
    );
    expect(mocks.emitEvent).toHaveBeenCalledOnce();
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      "achievement.unlocked",
      "achievement",
      "student-1",
      expect.objectContaining({ type: "first_session" }),
      "student-1",
    );
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "student-1",
        type: "system",
        title: "أول جلسة",
      }),
    );
  });

  it("returns awarded:false and skips emit/notify on duplicate (23505)", async () => {
    makeAdmin({ error: { code: "23505", message: "unique violation" } });

    const result = await awardAchievement("student-1", "first_session");

    expect(result).toEqual({ awarded: false });
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("returns awarded:false and skips emit/notify on other DB error", async () => {
    makeAdmin({ error: { code: "42P01", message: "table does not exist" } });

    const result = await awardAchievement("student-1", "first_session");

    expect(result).toEqual({ awarded: false });
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("passes metadata_json through to the insert", async () => {
    makeAdmin({ error: null });

    await awardAchievement("student-2", "first_juz", { juz: 30 });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata_json: { juz: 30 } }),
    );
  });

  it("emitEvent rejection is swallowed (best-effort) and still returns awarded:true", async () => {
    makeAdmin({ error: null });
    mocks.emitEvent.mockRejectedValue(new Error("n8n down"));

    const result = await awardAchievement("student-1", "streak_7");

    expect(result).toEqual({ awarded: true });
    // notify still runs
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("notify rejection is swallowed (best-effort) and still returns awarded:true", async () => {
    makeAdmin({ error: null });
    mocks.notify.mockRejectedValue(new Error("notify down"));

    const result = await awardAchievement("student-1", "streak_30");

    expect(result).toEqual({ awarded: true });
  });
});

describe("catalog completeness", () => {
  const AWARDED_TYPES: AchievementType[] = [
    "first_session",
    "first_juz",
    "streak_7",
    "streak_30",
    "level_up_intermediate",
    "level_up_advanced",
  ];

  it("every awarded type has a BADGE_CATALOG entry with required fields", () => {
    for (const type of AWARDED_TYPES) {
      const badge = BADGE_CATALOG[type];
      expect(badge, `missing catalog entry for ${type}`).toBeDefined();
      expect(badge.labelAr, `${type}.labelAr must be non-empty`).toBeTruthy();
      expect(badge.labelEn, `${type}.labelEn must be non-empty`).toBeTruthy();
      expect(badge.icon, `${type}.icon must be non-empty`).toBeTruthy();
      expect(badge.awardable, `${type} must be awardable=true`).toBe(true);
    }
  });

  it("first_correction_clean catalog entry is marked awardable:false (deferred)", () => {
    expect(BADGE_CATALOG["first_correction_clean"].awardable).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (must be before imports — Vitest hoists vi.mock calls) ─────────

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));

const mockIsFeatureEnabled = vi.fn();
vi.mock("@/lib/settings", () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// Admin client mock — unused when automation is gated off (gating tests only
// need the no-op path, so the minimal stub is enough).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications/dispatcher-quiet-hours", () => ({
  isInQuietHours: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUser: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}));

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks.
import { shouldNudge, buildNudgeCopy, runReengagementNudge, REENGAGE_DETECTION } from "./retention-nudge";

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-01T12:00:00Z");
const MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS).toISOString();
}

// ── shouldNudge — detection predicate ───────────────────────────────────────

describe("shouldNudge", () => {
  it("returns false for null lastSessionAt", () => {
    expect(shouldNudge(null, null, NOW)).toBe(false);
  });

  it("excludes a student lapsed exactly 7 days (boundary: must be strictly older)", () => {
    // exactly 7d ago is NOT < lapsedCutoff, so excluded
    expect(shouldNudge(daysAgo(7), null, NOW)).toBe(false);
  });

  it("includes a student lapsed 8 days (over threshold, under cap)", () => {
    expect(shouldNudge(daysAgo(8), null, NOW)).toBe(true);
  });

  it("excludes a student lapsed more than 60 days (churned)", () => {
    expect(shouldNudge(daysAgo(61), null, NOW)).toBe(false);
  });

  it("excludes when within 14-day cooldown (intervention 5 days ago)", () => {
    expect(shouldNudge(daysAgo(10), daysAgo(5), NOW)).toBe(false);
  });

  it("includes when cooldown has expired (intervention 15 days ago)", () => {
    expect(shouldNudge(daysAgo(10), daysAgo(15), NOW)).toBe(true);
  });

  it("includes when last_intervention_at is null (never nudged before)", () => {
    expect(shouldNudge(daysAgo(10), null, NOW)).toBe(true);
  });

  it("exposes named constants", () => {
    expect(REENGAGE_DETECTION.lapsedDays).toBe(7);
    expect(REENGAGE_DETECTION.cooldownDays).toBe(14);
    expect(REENGAGE_DETECTION.capDays).toBe(60);
  });
});

// ── buildNudgeCopy — personalization ────────────────────────────────────────

describe("buildNudgeCopy", () => {
  it("returns generic warm fallback when progress is null", () => {
    const copy = buildNudgeCopy(null);
    expect(copy.title).toBe("واصل رحلتك مع القرآن 🌙");
    // No ayah reference in the fallback body
    expect(copy.body).not.toContain("آية");
  });

  it("uses canonical surah name from surahs.ts — never model-generated", () => {
    // Quran integrity (AGENTS.md §2): name must come only from src/lib/quran/surahs.ts
    const copy = buildNudgeCopy({ surah_to: 1, ayah_to: 3 });
    expect(copy.body).toContain("الفاتحة");
    expect(copy.body).toContain("3");
  });

  it("uses correct canonical name for surah 2 (Al-Baqarah)", () => {
    const copy = buildNudgeCopy({ surah_to: 2, ayah_to: 255 });
    expect(copy.body).toContain("البقرة");
    expect(copy.body).toContain("255");
  });

  it("falls back to generic when surah_to is null", () => {
    const copy = buildNudgeCopy({ surah_to: null, ayah_to: null });
    expect(copy.body).not.toContain("آية");
  });

  it("falls back to generic when surah_to is out of range (0)", () => {
    const copy = buildNudgeCopy({ surah_to: 0, ayah_to: 1 });
    expect(copy.body).not.toContain("آية");
  });

  it("falls back to generic when surah_to is out of range (115)", () => {
    const copy = buildNudgeCopy({ surah_to: 115, ayah_to: 1 });
    expect(copy.body).not.toContain("آية");
  });
});

// ── runReengagementNudge — automation gate ──────────────────────────────────

describe("runReengagementNudge — gating off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops and returns zeros when automation_enabled is false", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 0, nudged: 0, skipped: 0 });
  });

  it("no-ops when retention_automation_enabled is false (automation_enabled=true)", async () => {
    mockIsFeatureEnabled.mockImplementation((key: string) =>
      Promise.resolve(key !== "retention_automation_enabled"),
    );
    const result = await runReengagementNudge();
    expect(result).toEqual({ detected: 0, nudged: 0, skipped: 0 });
  });
});

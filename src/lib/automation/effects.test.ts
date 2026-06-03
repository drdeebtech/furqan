import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the in-app dispatcher so we assert the fan-out shape without touching
// Supabase. dispatchEffects fans out THROUGH notify(), one call per effect.
const notifyMock = vi.fn<(opts: unknown) => Promise<void>>().mockResolvedValue(undefined);
vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (opts: unknown) => notifyMock(opts),
}));

// Silence logError (best-effort failure path) — assert it's not noisy.
const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { dispatchEffects, EVENT_EFFECTS } from "./effects";

beforeEach(() => {
  notifyMock.mockClear();
  logErrorMock.mockClear();
});

describe("EVENT_EFFECTS / dispatchEffects", () => {
  it("booking.created dispatches the declared teacher notification", async () => {
    await dispatchEffects("booking.created", {
      teacherId: "teacher-1",
      entityId: "booking-1",
      dateLabel: "١٢‏/٥‏/٢٠٢٦",
    });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "teacher-1",
        type: "booking",
        title: "حجز جديد",
        body: "لديك حجز جديد بتاريخ ١٢‏/٥‏/٢٠٢٦ — يرجى التأكيد",
        entityType: "booking",
        entityId: "booking-1",
      }),
    );
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("homework.assigned dispatches the declared student notification", async () => {
    await dispatchEffects("homework.assigned", {
      studentId: "student-1",
      entityId: "booking-9",
      title: "سورة البقرة ١-٥",
    });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "student-1",
        type: "homework",
        title: "متابعة جديدة",
        body: "كلّفك معلمك بمتابعة جديدة — سورة البقرة ١-٥",
        entityType: "homework",
        entityId: "booking-9",
      }),
    );
  });

  it("skips silently when the recipient id is missing (no notify, no throw)", async () => {
    await expect(
      dispatchEffects("booking.created", { entityId: "booking-1", dateLabel: "x" }),
    ).resolves.toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("is a no-op for events with no declared effects", async () => {
    await dispatchEffects("session.auto_completed", { entityId: "x" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("never throws when notify() rejects, and logs the failure", async () => {
    notifyMock.mockRejectedValueOnce(new Error("supabase down"));

    await expect(
      dispatchEffects("homework.assigned", {
        studentId: "student-1",
        entityId: "booking-9",
        title: "X",
      }),
    ).resolves.toBeUndefined();

    expect(logErrorMock).toHaveBeenCalledWith(
      "dispatchEffects: notify failed",
      expect.any(Error),
      expect.objectContaining({ tag: "automation-effects", event: "homework.assigned" }),
    );
  });

  it("only declares the migrated events (scope guard for this PR)", () => {
    expect(Object.keys(EVENT_EFFECTS).sort()).toEqual(
      ["booking.created", "homework.assigned", "session.no_show"].sort(),
    );
  });
});

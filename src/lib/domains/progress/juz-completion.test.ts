import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const mocks = vi.hoisted(() => ({
  issueCertificate: vi.fn(),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/domains/certificates/issue", () => ({
  issueCertificate: mocks.issueCertificate,
}));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("@/lib/notifications/dispatcher", () => ({ notify: mocks.notify }));

import { detectJuzCompletions } from "./juz-completion";

const certificate = {
  id: "certificate-30",
  student_id: "student-1",
  certificate_type: "appreciation_juz" as const,
  milestone_key: "30",
  cited_range_start: "78:1",
  cited_range_end: "114:6",
  issued_at: "2026-06-27T00:00:00.000Z",
};

function adminWithCompletedJuz(): SupabaseClient<Database> {
  const ownerQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { student_id: "student-1", teacher_id: "teacher-1" },
      error: null,
    }),
  };
  const rangesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({
      data: [{ surah_from: 78, ayah_from: 1, surah_to: 114, ayah_to: 6 }],
      error: null,
    }),
  };
  const from = vi.fn().mockReturnValueOnce(ownerQuery).mockReturnValueOnce(rangesQuery);
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emitEvent.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
});

describe("detectJuzCompletions", () => {
  it("emits and notifies both users for a newly issued juz certificate", async () => {
    mocks.issueCertificate.mockResolvedValue({ ok: true, certificate, idempotent: false });

    await detectJuzCompletions(adminWithCompletedJuz(), "progress-1");

    expect(mocks.issueCertificate).toHaveBeenCalledWith("student-1", "appreciation_juz", "30");
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      "progress.juz_completed",
      "student_progress",
      "student-1",
      { student_id: "student-1", teacher_id: "teacher-1", juz: 30 },
    );
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-1", title: "مبارك! أتممت الجزء 30" }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "teacher-1", title: "أتمّ الطالب الجزء 30" }),
    );
  });

  it("does not emit or notify for an already issued juz certificate", async () => {
    mocks.issueCertificate.mockResolvedValue({ ok: true, certificate, idempotent: true });

    await detectJuzCompletions(adminWithCompletedJuz(), "progress-1");

    expect(mocks.issueCertificate).toHaveBeenCalledWith("student-1", "appreciation_juz", "30");
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

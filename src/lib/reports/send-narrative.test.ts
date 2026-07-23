import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/notifications/dispatcher", () => ({ notify: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn() }));
vi.mock("./session-narrative", () => ({
  buildSessionNarrative: vi.fn(async () => ({
    session_id: "session-1",
    subject: "ملخص الجلسة",
    student_name: "الطالب",
    teacher_name: "المعلم",
    session_date_ar: "الاثنين",
    duration_min: 30,
    session_type_ar: "حفظ",
    narrative_paragraph: "narrative",
    teaching_points: ["point"],
    homework: null,
    evaluation: null,
    next_steps: "next",
    generated_via: "template",
  })),
}));

// Records exactly what gets passed to `.from("parent_reports").insert(...)` so the test
// fails if the payload ever regresses to phantom columns (body/sent_to_email/sent_to_phone/
// created_by) — the bug this fix corrects (was masked by an `as never` cast).
let capturedInsertPayload: unknown;

const automationLogsSelectChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
};
const sessionsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { booking_id: "booking-1" } }),
};
const bookingsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { student_id: "student-1", teacher_id: "teacher-1" } }),
};
const profilesChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: { parent_name: "Parent", parent_email: "parent@example.com", parent_phone: "+15551234" },
  }),
};
const parentReportsChain = {
  insert: vi.fn((payload: unknown) => {
    capturedInsertPayload = payload;
    return parentReportsChain;
  }),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: "report-1" }, error: null }),
};
const automationLogsInsertChain = { insert: vi.fn().mockResolvedValue({ error: null }) };

// vi.mock factories run during hoisted mock registration, before any of this
// file's own top-level code — a plain `const fromMock = vi.fn()` here would
// be a live TDZ reference when the "@/lib/supabase/admin" factory below
// closes over it (it happens to work today only because the import that
// triggers module evaluation is written after this line; reorder the
// imports and it breaks). vi.hoisted initializes it before any hoisted
// vi.mock factory runs, so the closure is never fragile on source order.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

import { sendSessionNarrative } from "./send-narrative";

beforeEach(() => {
  vi.clearAllMocks();
  capturedInsertPayload = undefined;
  automationLogsSelectChain.maybeSingle.mockResolvedValue({ data: null });
  parentReportsChain.single.mockResolvedValue({ data: { id: "report-1" }, error: null });
  fromMock
    .mockReturnValueOnce(automationLogsSelectChain) // idempotency check
    .mockReturnValueOnce(sessionsChain)
    .mockReturnValueOnce(bookingsChain)
    .mockReturnValueOnce(profilesChain)
    .mockReturnValueOnce(parentReportsChain)
    .mockReturnValueOnce(automationLogsInsertChain); // idempotency marker
});

describe("sendSessionNarrative — parent_reports insert payload", () => {
  it("uses the real parent_reports columns with non-null content, no phantom columns", async () => {
    const result = await sendSessionNarrative({ sessionId: "session-1", actorId: "actor-1" });

    expect(result.ok).toBe(true);
    expect(parentReportsChain.insert).toHaveBeenCalledTimes(1);

    // Exact shape — fails if a phantom column (body/sent_to_email/sent_to_phone/created_by)
    // sneaks back in, or if a real required column goes missing.
    expect(capturedInsertPayload).toStrictEqual({
      student_id: "student-1",
      teacher_id: "teacher-1",
      report_type: "session_summary",
      title: "ملخص الجلسة",
      content: expect.any(String),
      parent_email: "parent@example.com",
      parent_phone: "+15551234",
      sent_at: expect.any(String),
    });

    const payload = capturedInsertPayload as Record<string, unknown>;
    expect(payload.content).toBeTruthy(); // content is NOT NULL in the schema
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("sent_to_email");
    expect(payload).not.toHaveProperty("sent_to_phone");
    expect(payload).not.toHaveProperty("created_by");
  });
});

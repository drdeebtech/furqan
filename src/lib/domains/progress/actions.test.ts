import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the progress domain's evaluation write surface (ADR-0002).
 *
 * Mirrors the house style in domains/booking/orchestrate.test.ts: mock every
 * I/O boundary, build a minimal chainable fake client per test, assert
 * through what the fake client recorded (not mocks-of-mocks).
 */

const mockNotify = vi.fn();
const mockEmitEvent = vi.fn();
const mockLogError = vi.fn();

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
}));

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock("server-only", () => ({}));

import { createEvaluationRecord } from "./actions";
import { UserError } from "@/lib/actions/user-error";
import type { CreateEvaluationInput } from "./actions";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const STUDENT_ID = "s1";
const TEACHER_ID = "t1";

const BASE_INPUT: CreateEvaluationInput = {
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  evaluationType: "weekly",
  evaluationDate: "2026-07-01",
  scores: { hifz: 5, tajweed: 4, fluency: 4, attendance: 5, overall: 5 },
  text: {
    strengths: "جيد جداً",
    areasForImprovement: null,
    nextGoals: null,
    teacherComments: null,
  },
  actor: { id: TEACHER_ID, role: "teacher" },
};

// Chainable fake client — `from()` dispatches per table, mirroring the
// house style in _shared/teacher-reads.test.ts and orchestrate.test.ts.
function createFakeClient(opts: {
  relation?: { id: string } | null;
  insertError?: unknown;
}) {
  const insertMock = vi.fn(() => Promise.resolve({ error: opts.insertError ?? null }));
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: opts.relation ?? null });

  const bookingsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleMock,
  };
  const evaluationsBuilder = { insert: insertMock };

  const from = vi.fn((table: string) => {
    if (table === "bookings") return bookingsBuilder;
    if (table === "session_evaluations") return evaluationsBuilder;
    throw new Error(`fake client: unexpected table "${table}"`);
  });

  return { from, insertMock, maybeSingleMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockEmitEvent.mockResolvedValue(undefined);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createEvaluationRecord", () => {
  it("throws UserError when a teacher has no teaching relation to the student, and never inserts", async () => {
    const client = createFakeClient({ relation: null });

    await expect(
      createEvaluationRecord(client as never, BASE_INPUT),
    ).rejects.toThrow(UserError);
    await expect(
      createEvaluationRecord(client as never, BASE_INPUT),
    ).rejects.toThrow("لا يمكنك تقييم طالب لم تُدرّسه");

    expect(client.from).not.toHaveBeenCalledWith("session_evaluations");
  });

  it("teacher with a relation: inserts, notifies the student only, and emits evaluation.created", async () => {
    const client = createFakeClient({ relation: { id: "rel1" } });

    await createEvaluationRecord(client as never, BASE_INPUT);

    expect(client.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: "s1", teacher_id: "t1", overall_score: 5 }),
    );

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "s1",
        title: "تقييم جديد من معلمك",
        body: "أضاف معلمك تقييماً جديداً — يمكنك الاطلاع عليه من صفحة التقييمات",
      }),
    );

    expect(mockEmitEvent).toHaveBeenCalledWith("evaluation.created", "evaluation", "s1", {
      student_id: "s1",
      teacher_id: "t1",
      evaluation_type: "weekly",
    });
  });

  it("admin actor: skips the relation check and notifies both parties", async () => {
    // A never-called `from("bookings")` fake would still work — admin never
    // reaches the query — but pass a permissive relation to prove the guard
    // is genuinely skipped, not merely evaluated leniently.
    const client = createFakeClient({ relation: null });
    const adminInput: CreateEvaluationInput = {
      ...BASE_INPUT,
      actor: { id: "admin1", role: "admin" },
    };

    await createEvaluationRecord(client as never, adminInput);

    expect(client.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ student_id: "s1", teacher_id: "t1" }),
    );

    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "s1",
        title: "تقييم جديد",
        body: "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات",
      }),
    );
    expect(mockNotify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "t1",
        title: "تقييم جديد",
        body: "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات",
      }),
    );
  });

  it("rethrows the raw insert error and never notifies or emits", async () => {
    const insertError = { message: "insert failed", code: "23505" };
    const client = createFakeClient({ relation: { id: "rel1" }, insertError });

    await expect(createEvaluationRecord(client as never, BASE_INPUT)).rejects.toBe(insertError);

    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("tolerates a rejected notify — still resolves, and still emits", async () => {
    const client = createFakeClient({ relation: { id: "rel1" } });
    mockNotify.mockRejectedValueOnce(new Error("dispatcher down"));

    await expect(createEvaluationRecord(client as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalled();
  });
});

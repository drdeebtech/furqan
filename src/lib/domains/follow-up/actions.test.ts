import { describe, it, expect, vi, beforeEach } from "vitest";

// Side-effect modules — stubbed so the domain's decision logic is testable
// without HTTP / auth / network. Mirrors the Booking/Progress domain test
// approach (mock server-only + the I/O collaborators).
vi.mock("server-only", () => ({}));

const notifyMock = vi.fn().mockResolvedValue(undefined);
const notifyParentMock = vi.fn().mockResolvedValue(undefined);
const emitEventMock = vi.fn().mockResolvedValue(undefined);
const logErrorMock = vi.fn();

vi.mock("@/lib/notifications/dispatcher", () => ({ notify: (...a: unknown[]) => notifyMock(...a) }));
vi.mock("@/lib/notifications/parent", () => ({
  notifyParentHomeworkNotDone: (...a: unknown[]) => notifyParentMock(...a),
}));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: (...a: unknown[]) => emitEventMock(...a) }));
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logErrorMock(...a) }));

import { createFollowUp, markStudentReady, gradeFollowUp } from "./actions";
import { FollowUpUserError, FollowUpNotFoundError, type FollowUpActor } from "./types";

const TEACHER: FollowUpActor = { id: "teacher-1", isAdmin: false };
const ADMIN: FollowUpActor = { id: "admin-1", isAdmin: true };
const STUDENT: FollowUpActor = { id: "student-1", isAdmin: false };

/**
 * Minimal chainable Supabase-client fake. Each `.from(table)` returns a
 * thenable query builder whose terminal (`.single()` / awaiting the
 * builder) resolves to a per-(table, op) scripted result. Insert / update /
 * delete record their payloads for assertions.
 */
type Result = { data?: unknown; error?: unknown };

interface Script {
  select?: Result;
  insert?: Result;
  update?: Result;
  delete?: Result;
}

function makeClient(scripts: Record<string, Script | Script[]>) {
  const calls: Record<string, unknown[]> = { insert: [], update: [], delete: [] };
  const selectCursor: Record<string, number> = {};

  function builder(table: string) {
    let op: keyof Script = "select";
    let payload: unknown;
    const b: Record<string, unknown> = {};
    const chain = () => b;

    b.select = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.gt = vi.fn(chain);
    b.order = vi.fn(chain);
    b.limit = vi.fn(chain);
    b.returns = vi.fn(chain);
    b.insert = vi.fn((p: unknown) => {
      op = "insert";
      payload = p;
      (calls.insert as unknown[]).push({ table, payload: p });
      return b;
    });
    b.update = vi.fn((p: unknown) => {
      op = "update";
      payload = p;
      (calls.update as unknown[]).push({ table, payload: p });
      return b;
    });
    b.delete = vi.fn(() => {
      op = "delete";
      (calls.delete as unknown[]).push({ table });
      return b;
    });

    const resolve = (): Result => {
      const script = scripts[table];
      const s = Array.isArray(script)
        ? script[(selectCursor[table] = (selectCursor[table] ?? -1) + 1)] ?? {}
        : script ?? {};
      return (s[op] as Result) ?? { data: null, error: null };
    };

    b.single = vi.fn(async () => resolve());
    b.then = (onF: (r: Result) => unknown) => Promise.resolve(resolve()).then(onF);
    void payload;
    return b;
  }

  return {
    client: { from: vi.fn((t: string) => builder(t)) } as never,
    calls,
  };
}

beforeEach(() => {
  notifyMock.mockClear();
  notifyParentMock.mockClear();
  emitEventMock.mockClear();
  logErrorMock.mockClear();
});

// ─── createFollowUp ──────────────────────────────────────────────────────────

const createInput = {
  bookingId: "bk-1",
  studentId: "student-1",
  sessionId: null,
  homeworkType: "hifz",
  title: "سورة الفاتحة",
  description: null,
  surahNumber: 1,
  ayahStart: 1,
  ayahEnd: 7,
  pagesCount: null,
  dueDate: null,
  reviewHorizon: "near" as const,
};

describe("createFollowUp", () => {
  it("inserts, notifies the student, and emits homework.assigned when the teacher owns the booking", async () => {
    const { client, calls } = makeClient({
      bookings: { select: { data: { teacher_id: "teacher-1" }, error: null } },
      homework_assignments: { insert: { data: null, error: null } },
    });
    const out = await createFollowUp(client, TEACHER, createInput);
    expect(out).toEqual({ studentId: "student-1", bookingId: "bk-1" });
    expect(calls.insert).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledOnce();
    expect(emitEventMock).toHaveBeenCalledWith(
      "homework.assigned",
      "homework",
      "bk-1",
      expect.objectContaining({ student_id: "student-1", teacher_id: "teacher-1" }),
    );
  });

  it("lets an admin create on a booking they don't own (admin bypass)", async () => {
    const { client, calls } = makeClient({
      bookings: { select: { data: { teacher_id: "someone-else" }, error: null } },
      homework_assignments: { insert: { data: null, error: null } },
    });
    await createFollowUp(client, ADMIN, createInput);
    expect(calls.insert).toHaveLength(1);
  });

  it("rejects a non-owning, non-admin teacher", async () => {
    const { client, calls } = makeClient({
      bookings: { select: { data: { teacher_id: "someone-else" }, error: null } },
    });
    await expect(createFollowUp(client, TEACHER, createInput)).rejects.toBeInstanceOf(
      FollowUpUserError,
    );
    expect(calls.insert).toHaveLength(0);
  });

  it("blocks even an admin when the ownership read hits a real infra error", async () => {
    const { client } = makeClient({
      bookings: { select: { data: null, error: { code: "08006", message: "conn lost" } } },
    });
    await expect(createFollowUp(client, ADMIN, createInput)).rejects.toBeInstanceOf(
      FollowUpUserError,
    );
  });

  it("throws (cause-wrapped) when the insert fails", async () => {
    const { client } = makeClient({
      bookings: { select: { data: { teacher_id: "teacher-1" }, error: null } },
      homework_assignments: { insert: { data: null, error: { message: "boom" } } },
    });
    await expect(createFollowUp(client, TEACHER, createInput)).rejects.toBeInstanceOf(
      FollowUpUserError,
    );
    expect(emitEventMock).not.toHaveBeenCalled();
  });
});

// ─── markStudentReady ────────────────────────────────────────────────────────

describe("markStudentReady", () => {
  it("marks an assigned row ready and emits homework.student_ready", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: { student_id: "student-1", teacher_id: "teacher-1", status: "assigned", title: "ت" },
          error: null,
        },
        update: { data: null, error: null },
      },
      profiles: { select: { data: { full_name: "أحمد" }, error: null } },
    });
    const out = await markStudentReady(client, STUDENT, { followUpId: "hw-1", audio: null });
    expect(out).toEqual({ followUpId: "hw-1", studentId: "student-1", teacherId: "teacher-1" });
    expect(calls.update).toHaveLength(1);
    expect(emitEventMock).toHaveBeenCalledWith(
      "homework.student_ready",
      "homework",
      "hw-1",
      expect.objectContaining({ student_id: "student-1", teacher_id: "teacher-1" }),
    );
  });

  it("rejects when the actor is not the owning student", async () => {
    const { client } = makeClient({
      homework_assignments: {
        select: {
          data: { student_id: "other", teacher_id: "teacher-1", status: "assigned", title: "ت" },
          error: null,
        },
      },
    });
    await expect(
      markStudentReady(client, STUDENT, { followUpId: "hw-1", audio: null }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("rejects when the row is not in 'assigned' status", async () => {
    const { client } = makeClient({
      homework_assignments: {
        select: {
          data: { student_id: "student-1", teacher_id: "teacher-1", status: "student_ready", title: "ت" },
          error: null,
        },
      },
    });
    await expect(
      markStudentReady(client, STUDENT, { followUpId: "hw-1", audio: null }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("rejects a wrong-prefix audio path (defense in depth)", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: { student_id: "student-1", teacher_id: "teacher-1", status: "assigned", title: "ت" },
          error: null,
        },
      },
    });
    await expect(
      markStudentReady(client, STUDENT, {
        followUpId: "hw-1",
        audio: { path: "someone-else/hw-1/clip.webm", durationSeconds: 10 },
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.update).toHaveLength(0);
  });

  it("rejects an out-of-range audio duration", async () => {
    const { client } = makeClient({
      homework_assignments: {
        select: {
          data: { student_id: "student-1", teacher_id: "teacher-1", status: "assigned", title: "ت" },
          error: null,
        },
      },
    });
    await expect(
      markStudentReady(client, STUDENT, {
        followUpId: "hw-1",
        audio: { path: "student-1/hw-1/clip.webm", durationSeconds: 999 },
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("throws NotFound when the row is missing", async () => {
    const { client } = makeClient({
      homework_assignments: { select: { data: null, error: { code: "PGRST116" } } },
    });
    await expect(
      markStudentReady(client, STUDENT, { followUpId: "hw-1", audio: null }),
    ).rejects.toBeInstanceOf(FollowUpNotFoundError);
  });
});

// ─── gradeFollowUp ───────────────────────────────────────────────────────────

function gradeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "hw-1",
    booking_id: "bk-1",
    student_id: "student-1",
    teacher_id: "teacher-1",
    status: "student_ready",
    title: "سورة",
    homework_type: "hifz",
    description: null,
    surah_number: 1,
    ayah_start: 1,
    ayah_end: 7,
    pages_count: null,
    review_horizon: "near",
    ...overrides,
  };
}

describe("gradeFollowUp", () => {
  it("grades a student_ready row, notifies, and emits homework.graded", async () => {
    const { client, calls } = makeClient({
      homework_assignments: { select: { data: gradeRow(), error: null }, update: { data: null, error: null } },
    });
    const out = await gradeFollowUp(client, TEACHER, {
      followUpId: "hw-1",
      grade: "completed_good",
      teacherNotes: "أحسنت",
    });
    expect(out).toEqual({
      followUpId: "hw-1",
      studentId: "student-1",
      teacherId: "teacher-1",
      grade: "completed_good",
    });
    expect(calls.update).toHaveLength(1);
    expect(notifyParentMock).not.toHaveBeenCalled(); // no regen on a passing grade
    expect(emitEventMock).toHaveBeenCalledWith(
      "homework.graded",
      "homework",
      "hw-1",
      expect.objectContaining({ grade: "completed_good" }),
    );
  });

  it("auto-regenerates + notifies the parent on completed_not_done", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: { data: gradeRow(), error: null },
        update: { data: null, error: null },
        insert: { data: null, error: null },
      },
    });
    await gradeFollowUp(client, TEACHER, {
      followUpId: "hw-1",
      grade: "completed_not_done",
      teacherNotes: null,
    });
    // One update (the grade) + one insert (the regenerated child).
    expect(calls.update).toHaveLength(1);
    expect(calls.insert).toHaveLength(1);
    expect(notifyParentMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid grade before any read", async () => {
    const { client } = makeClient({});
    await expect(
      gradeFollowUp(client, TEACHER, {
        followUpId: "hw-1",
        grade: "assigned" as never,
        teacherNotes: null,
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("rejects when the row is not student_ready", async () => {
    const { client } = makeClient({
      homework_assignments: { select: { data: gradeRow({ status: "assigned" }), error: null } },
    });
    await expect(
      gradeFollowUp(client, TEACHER, {
        followUpId: "hw-1",
        grade: "completed_good",
        teacherNotes: null,
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("rejects a non-owning, non-admin teacher", async () => {
    const { client } = makeClient({
      homework_assignments: { select: { data: gradeRow({ teacher_id: "other" }), error: null } },
    });
    await expect(
      gradeFollowUp(client, TEACHER, {
        followUpId: "hw-1",
        grade: "completed_good",
        teacherNotes: null,
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("lets an admin grade a row they don't own", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: { data: gradeRow({ teacher_id: "other" }), error: null },
        update: { data: null, error: null },
      },
    });
    await gradeFollowUp(client, ADMIN, {
      followUpId: "hw-1",
      grade: "completed_good",
      teacherNotes: null,
    });
    expect(calls.update).toHaveLength(1);
  });
});

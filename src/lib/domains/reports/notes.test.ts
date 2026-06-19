import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => {
  const assignmentChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const notesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    returns: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  const fromMock = vi.fn((table: string) => {
    if (table === "subscription_teacher_assignments") return assignmentChain;
    return notesChain;
  });
  return { assignmentChain, notesChain, fromMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.fromMock })),
}));

import { getNotesForStudent, createNote, normalizeNoteContent, sanitizeForHeader } from "./notes";

const STUDENT = "student-aaa";
const TEACHER = "teacher-bbb";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignmentChain.select.mockReturnThis();
  mocks.assignmentChain.eq.mockReturnThis();
  mocks.notesChain.select.mockReturnThis();
  mocks.notesChain.eq.mockReturnThis();
  mocks.notesChain.order.mockReturnThis();
  mocks.notesChain.returns.mockReturnThis();
  mocks.notesChain.insert.mockReturnThis();
  mocks.fromMock.mockImplementation((table: string) => {
    if (table === "subscription_teacher_assignments") return mocks.assignmentChain;
    return mocks.notesChain;
  });
});

describe("normalizeNoteContent", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeNoteContent("  hello  ")).toBe("hello");
  });

  it("throws on empty string", () => {
    expect(() => normalizeNoteContent("")).toThrow(/empty/);
  });

  it("throws when content exceeds 5000 chars", () => {
    expect(() => normalizeNoteContent("x".repeat(5001))).toThrow(/exceeds/);
  });

  it("strips carriage return (FR-016)", () => {
    expect(normalizeNoteContent("line1\r\nline2")).toBe("line1\nline2");
  });
});

describe("sanitizeForHeader", () => {
  it("strips CR from header value", () => {
    expect(sanitizeForHeader("hello\rworld")).toBe("helloworld");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeForHeader("  hi  ")).toBe("hi");
  });

  it("handles empty string without throwing", () => {
    expect(sanitizeForHeader("")).toBe("");
  });
});

describe("getNotesForStudent", () => {
  it("returns notes array on success (admin mode)", async () => {
    const rows = [
      { id: "n1", student_id: STUDENT, teacher_id: TEACHER, content: "good progress", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.notesChain.returns.mockResolvedValueOnce({ data: rows, error: null });
    const result = await getNotesForStudent(STUDENT, { admin: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
  });

  it("returns empty array on DB error", async () => {
    mocks.notesChain.returns.mockResolvedValueOnce({ data: null, error: { message: "db error" } });
    const result = await getNotesForStudent(STUDENT, { admin: true });
    expect(result).toEqual([]);
  });
});

describe("createNote — teacher-assignment gate", () => {
  it("returns 403 when teacher is not assigned to student", async () => {
    mocks.assignmentChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await createNote(STUDENT, TEACHER, "test content");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it("returns 422 on empty content", async () => {
    const result = await createNote(STUDENT, TEACHER, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
    }
  });

  it("inserts and returns note when teacher is assigned", async () => {
    mocks.assignmentChain.maybeSingle.mockResolvedValueOnce({
      data: { teacher_id: TEACHER },
      error: null,
    });
    const noteRow = {
      id: "note-1",
      student_id: STUDENT,
      teacher_id: TEACHER,
      content: "excellent progress",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mocks.notesChain.single.mockResolvedValueOnce({ data: noteRow, error: null });

    const result = await createNote(STUDENT, TEACHER, "excellent progress");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note.id).toBe("note-1");
      expect(result.note.content).toBe("excellent progress");
    }
  });

  it("returns 500 when insert fails", async () => {
    mocks.assignmentChain.maybeSingle.mockResolvedValueOnce({
      data: { teacher_id: TEACHER },
      error: null,
    });
    mocks.notesChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "insert failed" },
    });
    const result = await createNote(STUDENT, TEACHER, "some content");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });
});

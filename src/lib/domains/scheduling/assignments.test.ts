import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { reassignTeacher } from "./assignments";

describe("reassignTeacher", () => {
  const assignmentId = "assignment-123";
  const newTeacherId = "teacher-456";
  const reason = "Student requested change";
  const adminId = "admin-789";
  const studentId = "student-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reassign teacher and cancel future bookings", async () => {
    const mockAdmin = {
      from: vi.fn().mockImplementation((table) => {
        if (table === "subscription_teacher_assignments") {
          return {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col) => {
              if (col === "id") {
                return {
                  single: vi.fn().mockResolvedValue({ data: { student_id: studentId }, error: null }),
                  then: (cb: any) => cb({ error: null })
                };
              }
              return this;
            }),
          };
        } else if (table === "bookings") {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            gt: vi.fn().mockResolvedValue({ count: 2, error: null }),
          };
        }
      })
    } as any;

    const result = await reassignTeacher(mockAdmin, assignmentId, newTeacherId, reason, adminId);

    expect(result.ok).toBe(true);
    expect(result.cancellationCount).toBe(2);
  });

  it("should throw if assignment not found", async () => {
    const mockAdmin = {
      from: vi.fn().mockImplementation((table) => {
        if (table === "subscription_teacher_assignments") {
          return {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col) => {
              if (col === "id") {
                return {
                  single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
                };
              }
              return this;
            }),
          };
        }
      })
    } as any;

    await expect(reassignTeacher(mockAdmin, assignmentId, newTeacherId, reason, adminId))
      .rejects.toThrow("Assignment not found");
  });
});

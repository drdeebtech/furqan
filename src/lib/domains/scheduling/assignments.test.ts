import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { reassignTeacher } from "./assignments";

/** Minimal admin-client mock shape (chainable per-table builder). */
interface AdminMock {
  from: ReturnType<typeof vi.fn>;
}

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
    const mockAdmin: AdminMock = {
      from: vi.fn().mockImplementation((table) => {
        if (table === "subscription_teacher_assignments") {
          return {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string) => {
              if (col === "id") {
                return {
                  single: vi.fn().mockResolvedValue({ data: { student_id: studentId }, error: null }),
                  then: (cb: (v: { error: unknown }) => void) => cb({ error: null }),
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
        return undefined;
      }),
    };

    const result = await reassignTeacher(
      mockAdmin as unknown as SupabaseClient<Database>,
      assignmentId,
      newTeacherId,
      reason,
      adminId,
    );

    expect(result.ok).toBe(true);
    expect(result.cancellationCount).toBe(2);
  });

  it("should throw if assignment not found", async () => {
    const mockAdmin: AdminMock = {
      from: vi.fn().mockImplementation((table) => {
        if (table === "subscription_teacher_assignments") {
          return {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string) => {
              if (col === "id") {
                return {
                  single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
                };
              }
              return this;
            }),
          };
        }
        return undefined;
      }),
    };

    await expect(
      reassignTeacher(
        mockAdmin as unknown as SupabaseClient<Database>,
        assignmentId,
        newTeacherId,
        reason,
        adminId,
      ),
    ).rejects.toThrow("Assignment not found");
  });
});

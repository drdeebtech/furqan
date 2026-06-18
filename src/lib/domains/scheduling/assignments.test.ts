import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { reassignTeacher } from "./assignments";

/**
 * Minimal admin-client mock. reassignTeacher delegates everything to the
 * reassign_teacher_atomic RPC, so the mock only needs an `rpc` resolver —
 * no fragile chainable query-builder doubles.
 */
interface AdminMock {
  rpc: ReturnType<typeof vi.fn>;
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
      rpc: vi.fn().mockResolvedValue({
        data: [{ student_id: studentId, cancellation_count: 2 }],
        error: null,
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
    expect(mockAdmin.rpc).toHaveBeenCalledWith("reassign_teacher_atomic", {
      p_assignment_id: assignmentId,
      p_new_teacher_id: newTeacherId,
      p_admin_id: adminId,
    });
  });

  it("should surface RPC error when assignment is missing (P0002)", async () => {
    const dbErr = { code: "P0002", message: "no_data_found" };
    const mockAdmin: AdminMock = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: dbErr }),
    };

    await expect(
      reassignTeacher(
        mockAdmin as unknown as SupabaseClient<Database>,
        assignmentId,
        newTeacherId,
        reason,
        adminId,
      ),
    ).rejects.toEqual(dbErr);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// The bulk loop delegates the grade write to `gradeFollowUp` — stub it so
// the test asserts the loop's own concerns: key→status mapping, the
// partial-success aggregate, the bulk-context audit row, and that genuine
// row failures are caught per-row (one bad row doesn't fail the batch).
const gradeFollowUpMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("./actions", () => ({
  gradeFollowUp: (...a: unknown[]) => gradeFollowUpMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logErrorMock(...a) }));

import { bulkGradeFollowUp } from "./bulk";
import { FollowUpUserError, FollowUpNotFoundError, type FollowUpActor } from "./types";

const ADMIN: FollowUpActor = { id: "admin-1", isAdmin: true };

function auditClient() {
  const inserts: unknown[] = [];
  const client = {
    from: vi.fn(() => ({
      insert: vi.fn((p: unknown) => {
        inserts.push(p);
        return { then: (f: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(f) };
      }),
    })),
  } as never;
  return { client, inserts };
}

beforeEach(() => {
  gradeFollowUpMock.mockReset();
  logErrorMock.mockClear();
});

describe("bulkGradeFollowUp", () => {
  it("returns an empty result for an empty / non-array input without touching the client", async () => {
    const { client } = auditClient();
    expect(await bulkGradeFollowUp(client, ADMIN, [])).toEqual({ graded: 0, failed: 0, errors: [] });
    expect(gradeFollowUpMock).not.toHaveBeenCalled();
  });

  it("maps each UI grade key to the HomeworkStatus enum and grades every valid row", async () => {
    gradeFollowUpMock.mockResolvedValue(undefined);
    const { client, inserts } = auditClient();
    const out = await bulkGradeFollowUp(client, ADMIN, [
      { id: "a", grade: "excellent" },
      { id: "b", grade: "good", feedback: "  جيد  " },
      { id: "c", grade: "needs_work" },
      { id: "d", grade: "not_done" },
    ]);
    expect(out).toEqual({ graded: 4, failed: 0, errors: [] });
    expect(gradeFollowUpMock).toHaveBeenNthCalledWith(1, client, ADMIN, {
      followUpId: "a",
      grade: "completed_excellent",
      teacherNotes: null,
    });
    expect(gradeFollowUpMock).toHaveBeenNthCalledWith(2, client, ADMIN, {
      followUpId: "b",
      grade: "completed_good",
      teacherNotes: "جيد", // trimmed
    });
    // One bulk-context audit row per graded item.
    expect(inserts).toHaveLength(4);
  });

  it("rejects malformed rows (missing id / bad grade key) without calling the grade write", async () => {
    const { client } = auditClient();
    const out = await bulkGradeFollowUp(client, ADMIN, [
      { id: "", grade: "good" },
      { id: "x", grade: "bogus" as never },
    ]);
    expect(out.graded).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.errors).toHaveLength(2);
    expect(gradeFollowUpMock).not.toHaveBeenCalled();
  });

  it("keeps going when one row fails and surfaces the not-found copy", async () => {
    gradeFollowUpMock
      .mockResolvedValueOnce(undefined) // row a ok
      .mockRejectedValueOnce(new FollowUpNotFoundError("المتابعة غير موجودة")) // row b missing
      .mockResolvedValueOnce(undefined); // row c ok
    const { client } = auditClient();
    const out = await bulkGradeFollowUp(client, ADMIN, [
      { id: "a", grade: "good" },
      { id: "b", grade: "good" },
      { id: "c", grade: "good" },
    ]);
    expect(out.graded).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.errors).toEqual(["المتابعة b غير موجودة"]);
  });

  it("surfaces a domain user-error message verbatim (e.g. not-ready guard)", async () => {
    gradeFollowUpMock.mockRejectedValueOnce(new FollowUpUserError("الطالب لم يؤكد جاهزيته بعد"));
    const { client } = auditClient();
    const out = await bulkGradeFollowUp(client, ADMIN, [{ id: "a", grade: "good" }]);
    expect(out.graded).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.errors).toEqual(["الطالب لم يؤكد جاهزيته بعد"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logErrorMock(...a) }));
vi.mock("@/lib/quran/surahs", () => ({ surahName: () => "الفاتحة" }));

import { editFollowUp, deleteFollowUp } from "./manage";
import { FollowUpUserError, type FollowUpActor } from "./types";

const TEACHER: FollowUpActor = { id: "teacher-1", isAdmin: false };

/**
 * Minimal chainable Supabase-client fake. `.from(table)` returns a thenable
 * builder whose terminal (`.single()` / awaiting) resolves to a
 * per-(table, op) scripted result. A table scripted as an array returns a
 * different result on each successive `.from(table)` (the delete cascade
 * reads/deletes the same table several times).
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
      (calls.insert as unknown[]).push({ table, payload: p });
      return b;
    });
    b.update = vi.fn((p: unknown) => {
      op = "update";
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
    return b;
  }

  return {
    client: { from: vi.fn((t: string) => builder(t)) } as never,
    calls,
  };
}

beforeEach(() => {
  logErrorMock.mockClear();
});

// ─── editFollowUp ────────────────────────────────────────────────────────────

describe("editFollowUp", () => {
  it("edits an un-graded row when there is no next session", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: { teacher_id: "teacher-1", student_id: "student-1", assigned_at: "2026-01-01", status: "assigned", surah_number: null, ayah_start: null, ayah_end: null },
          error: null,
        },
        update: { data: null, error: null },
      },
      bookings: { select: { data: null, error: { code: "PGRST116" } } },
    });
    const out = await editFollowUp(client, TEACHER, {
      followUpId: "hw-1",
      updates: { title: "جديد" },
    });
    expect(out).toEqual({ followUpId: "hw-1" });
    expect(calls.update).toHaveLength(1);
  });

  it("refuses to edit a graded row", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: {
            teacher_id: "teacher-1",
            student_id: "student-1",
            assigned_at: "2026-01-01",
            status: "completed_good",
            surah_number: null,
            ayah_start: null,
            ayah_end: null,
          },
          error: null,
        },
      },
    });
    await expect(
      editFollowUp(client, TEACHER, { followUpId: "hw-1", updates: { title: "x" } }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.update).toHaveLength(0);
  });

  it("refuses to edit once the next session has started (edit window closed)", async () => {
    const { client } = makeClient({
      homework_assignments: {
        select: {
          data: { teacher_id: "teacher-1", student_id: "student-1", assigned_at: "2026-01-01", status: "assigned", surah_number: null, ayah_start: null, ayah_end: null },
          error: null,
        },
      },
      bookings: { select: { data: { id: "bk-2" }, error: null } },
      sessions: { select: { data: { started_at: "2026-02-01T10:00:00Z" }, error: null } },
    });
    await expect(
      editFollowUp(client, TEACHER, { followUpId: "hw-1", updates: { title: "x" } }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
  });

  it("rejects a partial ayah_end edit that exceeds the stored surah count (regression: HIGH-1 partial-edit bypass)", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: {
            teacher_id: "teacher-1",
            student_id: "student-1",
            assigned_at: "2026-01-01",
            status: "assigned",
            surah_number: 1,
            ayah_start: 1,
            ayah_end: 7,
          },
          error: null,
        },
        update: { data: null, error: null },
      },
      bookings: { select: { data: null, error: { code: "PGRST116" } } },
    });
    await expect(
      editFollowUp(client, TEACHER, {
        followUpId: "hw-1",
        updates: { ayah_end: 999 },
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.update).toHaveLength(0);
  });

  it("rejects a partial null-clear edit (ayah_start null, ayah_end 999) with Arabic message (regression: partial null-clear UX)", async () => {
    const { client, calls } = makeClient({
      homework_assignments: {
        select: {
          data: {
            teacher_id: "teacher-1",
            student_id: "student-1",
            assigned_at: "2026-01-01",
            status: "assigned",
            surah_number: 1,
            ayah_start: 1,
            ayah_end: 7,
          },
          error: null,
        },
        update: { data: null, error: null },
      },
      bookings: { select: { data: null, error: { code: "PGRST116" } } },
    });
    await expect(
      editFollowUp(client, TEACHER, {
        followUpId: "hw-1",
        updates: { ayah_start: null, ayah_end: 999 },
      }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.update).toHaveLength(0);
  });
});

// ─── deleteFollowUp ──────────────────────────────────────────────────────────

describe("deleteFollowUp", () => {
  it("deletes the row + cascades children and returns the cascade size", async () => {
    const { client, calls } = makeClient({
      homework_assignments: [
        // 1st .from() — ownership read
        { select: { data: { teacher_id: "teacher-1" }, error: null } },
        // 2nd .from() — children read
        {
          select: {
            data: [
              { id: "c1", status: "assigned", title: "a" },
              { id: "c2", status: "assigned", title: "b" },
            ],
            error: null,
          },
        },
        // 3rd .from() — delete children
        { delete: { data: null, error: null } },
        // 4th .from() — delete parent
        { delete: { data: null, error: null } },
      ],
      audit_log: { insert: { data: null, error: null } },
    });
    const out = await deleteFollowUp(client, TEACHER, { followUpId: "hw-1" });
    expect(out).toEqual({ followUpId: "hw-1", cascadedChildren: 2 });
    // children delete + parent delete = 2 delete calls.
    expect(calls.delete).toHaveLength(2);
  });

  it("rejects a non-owning, non-admin teacher", async () => {
    const { client, calls } = makeClient({
      homework_assignments: { select: { data: { teacher_id: "other" }, error: null } },
    });
    await expect(
      deleteFollowUp(client, TEACHER, { followUpId: "hw-1" }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.delete).toHaveLength(0);
  });

  it("blocks the delete when the cascade-count read errors (no unbounded cascade)", async () => {
    const { client, calls } = makeClient({
      homework_assignments: [
        { select: { data: { teacher_id: "teacher-1" }, error: null } },
        { select: { data: null, error: { code: "08006", message: "conn lost" } } },
      ],
    });
    await expect(
      deleteFollowUp(client, TEACHER, { followUpId: "hw-1" }),
    ).rejects.toBeInstanceOf(FollowUpUserError);
    expect(calls.delete).toHaveLength(0);
  });
});

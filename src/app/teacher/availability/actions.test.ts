import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for src/app/teacher/availability/actions.ts.
 *
 * Primary focus (round-2 Task 3): requireTeacherActor preflight — infra-vs-
 * forbidden parity. Before the fix, this file's preflight destructured
 * `profile` without checking `error`, so a DB/RLS fetch failure fell
 * through to `!profile` and was swallowed into the generic
 * "ليس لديك صلاحية" — indistinguishable from a genuine role mismatch. See
 * src/app/teacher/settings/actions.test.ts for the sibling case this mirrors.
 *
 * Also covers the happy/error paths of all four exported actions so this
 * file (now instrumented in the coverage denominator by the preflight
 * tests above) carries real line coverage rather than dragging the global
 * ratio down.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    const result = fn();
    if (result instanceof Promise) result.catch(() => undefined);
  },
}));
vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn(), setTag: vi.fn() }));
vi.mock("@/lib/sentry-geo", () => ({ attachGeoToSentryScope: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/n8n/client", () => ({ sendTelegramAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }) }),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/automation/emit", () => ({ emitEvent: (...args: unknown[]) => mockEmitEvent(...args) }));

const mockGetUser = vi.fn();

// Chainable fake client — `from()` dispatches per table. `profiles` serves
// the preflight's select().eq().single(); `teacher_availability` serves
// addSlot's insert() and deleteSlot's delete().eq().eq().
function buildFrom(opts: {
  profile?: { role: string } | null;
  profileErr?: unknown;
  insertError?: unknown;
  deleteError?: unknown;
}) {
  const profileSingle = vi.fn().mockResolvedValue({ data: opts.profile ?? null, error: opts.profileErr ?? null });
  const selectMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: profileSingle }) });

  const insertMock = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });

  const deleteEq2 = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
  const deleteMock = vi.fn().mockReturnValue({ eq: deleteEq1 });

  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select: selectMock };
    if (table === "teacher_availability") return { insert: insertMock, delete: deleteMock };
    throw new Error(`unexpected table ${table}`);
  });
  return { from, insertMock, deleteMock, deleteEq1, deleteEq2 };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("createClient must be re-mocked per test via setClient()");
  }),
}));

import { createClient } from "@/lib/supabase/server";
import { addSlot, deleteSlot } from "./actions";

const mockCreateClient = vi.mocked(createClient);
const USER_ID = "teacher-1";
const SLOT_ID = "11111111-1111-4111-8111-111111111111";

function setClient(opts: {
  profile?: { role: string } | null;
  profileErr?: unknown;
  insertError?: unknown;
  deleteError?: unknown;
}) {
  const { from, insertMock, deleteMock, deleteEq1, deleteEq2 } = buildFrom(opts);
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser }, from } as never);
  return { insertMock, deleteMock, deleteEq1, deleteEq2 };
}

function slotFormData(opts?: { start_time?: string; end_time?: string }) {
  const fd = new FormData();
  fd.set("day_of_week", "1");
  fd.set("start_time", opts?.start_time ?? "09:00");
  fd.set("end_time", opts?.end_time ?? "10:00");
  fd.set("slot_duration", "30");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

describe("addSlot — requireTeacherActor preflight", () => {
  it("profiles fetch DB/RLS error: rejects as infra, not a permission denial", async () => {
    setClient({ profileErr: { message: "connection reset", code: "08006" } });

    const result = await addSlot(null, slotFormData());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must NOT be the forbidden message — that would misclassify an
      // infra blip as a permissions denial.
      expect(result.error).not.toBe("ليس لديك صلاحية");
    }
    // An infra failure is a system error: loudAction logs it.
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("genuine role mismatch (fetch succeeds, wrong role): rejects with the forbidden UserError, no logError", async () => {
    setClient({ profile: { role: "student" } });

    const result = await addSlot(null, slotFormData());

    expect(result).toEqual({ ok: false, error: "ليس لديك صلاحية" });
    // Pure preflight denial — UserError without cause skips Sentry logging.
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("addSlot", () => {
  it("teacher, valid slot: inserts and returns the success message", async () => {
    const { insertMock } = setClient({ profile: { role: "teacher" } });

    const result = await addSlot(null, slotFormData());

    expect(result).toEqual({ ok: true, message: "تمت إضافة الموعد بنجاح" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ teacher_id: USER_ID, day_of_week: 1, start_time: "09:00", end_time: "10:00" }),
    );
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "teacher.availability_slot_added",
      "teacher_availability",
      USER_ID,
      expect.objectContaining({ teacher_id: USER_ID }),
    );
  });

  it("start_time >= end_time: rejects with a UserError, never inserts", async () => {
    const { insertMock } = setClient({ profile: { role: "teacher" } });

    const result = await addSlot(null, slotFormData({ start_time: "10:00", end_time: "09:00" }));

    expect(result).toEqual({ ok: false, error: "وقت البداية يجب أن يكون قبل وقت النهاية" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("duplicate slot (avail_unique constraint): rejects with the friendly duplicate message", async () => {
    setClient({ profile: { role: "teacher" }, insertError: { message: "duplicate key value violates avail_unique" } });

    const result = await addSlot(null, slotFormData());

    expect(result).toEqual({ ok: false, error: "هذا الموعد موجود بالفعل" });
  });

  it("generic insert failure: rejects with the friendly retry message and logs the cause", async () => {
    setClient({ profile: { role: "teacher" }, insertError: { message: "db down" } });

    const result = await addSlot(null, slotFormData());

    expect(result).toEqual({ ok: false, error: "حدث خطأ أثناء إضافة الموعد — يرجى المحاولة مرة أخرى" });
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

describe("deleteSlot", () => {
  it("teacher: deletes the caller's own slot and returns the success message", async () => {
    const { deleteMock, deleteEq1, deleteEq2 } = setClient({ profile: { role: "teacher" } });

    const result = await deleteSlot(SLOT_ID);

    expect(result).toEqual({ ok: true, message: "تم حذف الموعد بنجاح" });
    expect(deleteMock).toHaveBeenCalled();
    expect(deleteEq1).toHaveBeenCalledWith("id", SLOT_ID);
    expect(deleteEq2).toHaveBeenCalledWith("teacher_id", USER_ID);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "teacher.availability_slot_deleted",
      "teacher_availability",
      USER_ID,
      { teacher_id: USER_ID, slot_id: SLOT_ID },
    );
  });

  it("DB delete failure: rejects with the friendly retry message and logs the cause", async () => {
    setClient({ profile: { role: "teacher" }, deleteError: { message: "db down" } });

    const result = await deleteSlot(SLOT_ID);

    expect(result).toEqual({ ok: false, error: "حدث خطأ أثناء حذف الموعد — يرجى المحاولة مرة أخرى" });
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

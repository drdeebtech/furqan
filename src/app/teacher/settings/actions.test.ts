import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for src/app/teacher/settings/actions.ts.
 *
 * Primary focus (round-2 Task 3): requireTeacherActor preflight —
 * infra-vs-forbidden parity. Mirrors src/lib/domains/progress/actions.test.ts's
 * "relation lookup fails at the DB/RLS level" case: a `profiles` fetch error
 * is an infra failure, not a permission denial, and must NOT be swallowed
 * into a UserError.
 *
 * Also covers the happy/error paths of both exported actions so this file
 * (now instrumented in the coverage denominator by the preflight tests
 * above) carries real line coverage rather than dragging the global ratio
 * down — see src/app/teacher/availability/actions.test.ts for the sibling.
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

// Chainable fake client — `from()` dispatches per table, mirroring the
// house style in progress/actions.test.ts. `profiles` serves both the
// preflight's select().eq().single() and updatePersonalInfo's
// update().eq(); `teacher_profiles` serves updateTeachingStatus's
// update().eq().
function buildFrom(opts: { profile?: { role: string } | null; profileErr?: unknown; updateError?: unknown }) {
  const profileSingle = vi.fn().mockResolvedValue({ data: opts.profile ?? null, error: opts.profileErr ?? null });
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const updateMock = vi.fn().mockReturnValue({ eq: updateEq });
  const selectMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: profileSingle }) });

  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select: selectMock, update: updateMock };
    if (table === "teacher_profiles") return { update: updateMock };
    throw new Error(`unexpected table ${table}`);
  });
  return { from, updateEq, updateMock };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("createClient must be re-mocked per test via setClient()");
  }),
}));

import { createClient } from "@/lib/supabase/server";
import { updatePersonalInfo, updateTeachingStatus } from "./actions";

const mockCreateClient = vi.mocked(createClient);
const USER_ID = "teacher-1";

function setClient(opts: { profile?: { role: string } | null; profileErr?: unknown; updateError?: unknown }) {
  const { from, updateEq, updateMock } = buildFrom(opts);
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser }, from } as never);
  return { updateEq, updateMock };
}

function teachingStatusFormData(isAccepting: boolean) {
  const fd = new FormData();
  fd.set("is_accepting", isAccepting ? "on" : "");
  return fd;
}

function personalInfoFormData() {
  const fd = new FormData();
  fd.set("full_name", "Ahmad");
  fd.set("phone", "0100000000");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

describe("requireTeacherActor preflight", () => {
  it("profiles fetch DB/RLS error: rejects as infra, not a permission denial", async () => {
    setClient({ profileErr: { message: "connection reset", code: "08006" } });

    const result = await updateTeachingStatus(null, teachingStatusFormData(true));

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

    const result = await updateTeachingStatus(null, teachingStatusFormData(true));

    expect(result).toEqual({ ok: false, error: "ليس لديك صلاحية" });
    // Pure preflight denial — UserError without cause skips Sentry logging.
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("updateTeachingStatus", () => {
  it("teacher accepting students: updates teacher_profiles and returns the accepting message", async () => {
    const { updateMock, updateEq } = setClient({ profile: { role: "teacher" } });

    const result = await updateTeachingStatus(null, teachingStatusFormData(true));

    expect(result).toEqual({ ok: true, message: "أنت تقبل طلابًا جددًا الآن" });
    expect(updateMock).toHaveBeenCalledWith({ is_accepting: true });
    expect(updateEq).toHaveBeenCalledWith("teacher_id", USER_ID);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "teacher.status_updated",
      "teacher_profile",
      USER_ID,
      { is_accepting: true },
      USER_ID,
    );
  });

  it("teacher pausing new students: returns the paused message", async () => {
    setClient({ profile: { role: "teacher" } });

    const result = await updateTeachingStatus(null, teachingStatusFormData(false));

    expect(result).toEqual({ ok: true, message: "تم إيقاف قبول طلاب جدد مؤقتًا" });
  });

  it("DB update failure: rejects as a system error (raw error, logged), not a UserError", async () => {
    setClient({ profile: { role: "teacher" }, updateError: { message: "db down" } });

    const result = await updateTeachingStatus(null, teachingStatusFormData(false));

    expect(result.ok).toBe(false);
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

describe("updatePersonalInfo", () => {
  it("teacher: updates profiles and returns the success message", async () => {
    const { updateMock, updateEq } = setClient({ profile: { role: "teacher" } });

    const result = await updatePersonalInfo(null, personalInfoFormData());

    expect(result).toEqual({ ok: true, message: "تم حفظ البيانات بنجاح" });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: "Ahmad", phone: "0100000000" }),
    );
    expect(updateEq).toHaveBeenCalledWith("id", USER_ID);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "profile.updated",
      "profile",
      USER_ID,
      expect.objectContaining({ full_name: "Ahmad" }),
      USER_ID,
    );
  });

  it("DB update failure: rejects as a system error (raw error, logged), not a UserError", async () => {
    setClient({ profile: { role: "teacher" }, updateError: { message: "db down" } });

    const result = await updatePersonalInfo(null, personalInfoFormData());

    expect(result.ok).toBe(false);
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/quran/surahs", () => ({ surahName: () => "الفاتحة" }));

import { recordProgress } from "./capture";

function rpcClient(result: { data?: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc: vi.fn().mockResolvedValue(result) } as any;
}

const validInput = {
  bookingId: "b1",
  progressType: "new" as const,
  range: { surahFrom: 2, ayahFrom: 1, surahTo: 2, ayahTo: 5 },
};

describe("recordProgress", () => {
  it("records a valid range and returns the progress id", async () => {
    const admin = rpcClient({ data: "prog-1" });
    const out = await recordProgress(admin, validInput);
    expect(out).toEqual({ ok: true, progressId: "prog-1" });
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_student_progress",
      expect.objectContaining({ p_surah_from: 2, p_ayah_to: 5, p_progress_type: "new" }),
    );
  });

  it("rejects an impossible range at the action layer (no RPC)", async () => {
    const admin = rpcClient({ data: "should-not-be-called" });
    const out = await recordProgress(admin, {
      ...validInput,
      range: { surahFrom: 1, ayahFrom: 1, surahTo: 1, ayahTo: 300 },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("invalid_range");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("requires a range for progressType=new", async () => {
    const admin = rpcClient({ data: null });
    const out = await recordProgress(admin, { bookingId: "b1", progressType: "new", range: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("missing_range");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("allows muraja with no range", async () => {
    const admin = rpcClient({ data: "prog-2" });
    const out = await recordProgress(admin, { bookingId: "b1", progressType: "muraja", range: null });
    expect(out).toEqual({ ok: true, progressId: "prog-2" });
  });

  it("maps the DB trigger raise (backstop) to invalid_range", async () => {
    const admin = rpcClient({ error: { message: "ayah_to 300 exceeds surah 1 ayah count 7" } });
    const out = await recordProgress(admin, validInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("invalid_range");
  });

  it("maps booking_not_found", async () => {
    const admin = rpcClient({ error: { message: "booking_not_found" } });
    const out = await recordProgress(admin, validInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not_found");
  });

  it("does NOT report success when the RPC returns no id (data null, no error)", async () => {
    const admin = rpcClient({ data: null, error: null });
    const out = await recordProgress(admin, validInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("error");
  });

  it("passes tajweed error annotations through to the RPC (regression: HIGH-2)", async () => {
    const admin = rpcClient({ data: "prog-err-1" });
    const errors = [
      { surahNum: 2, ayahNum: 3, errorType: "madd" as const, note: "elongation short" },
      { surahNum: 2, ayahNum: 5, errorType: "ghunna" as const, note: null },
    ];
    const out = await recordProgress(admin, { ...validInput, errors });
    expect(out).toEqual({ ok: true, progressId: "prog-err-1" });
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_student_progress",
      expect.objectContaining({
        p_errors: [
          { surah_num: 2, ayah_num: 3, error_type: "madd", note: "elongation short" },
          { surah_num: 2, ayah_num: 5, error_type: "ghunna", note: null },
        ],
      }),
    );
  });

  it("passes null errors when the field is omitted (regression: HIGH-2)", async () => {
    const admin = rpcClient({ data: "prog-ok" });
    await recordProgress(admin, validInput);
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_student_progress",
      expect.objectContaining({ p_errors: null }),
    );
  });

  it("returns { ok: false } when the RPC errors with non-null p_errors (regression: HIGH-2 test gap)", async () => {
    const admin = rpcClient({ error: { message: "booking_not_found" } });
    const errors = [
      { surahNum: 2, ayahNum: 3, errorType: "madd" as const, note: null },
    ];
    const out = await recordProgress(admin, { ...validInput, errors });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not_found");
  });

  // ─── correction requires at least one tajweed error (issue #533) ────────────
  it("rejects progressType=correction with no errors (domain guard)", async () => {
    const admin = rpcClient({ data: "should-not-be-called" });
    const out = await recordProgress(admin, {
      bookingId: "b1",
      progressType: "correction",
      range: null,
      errors: [],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("error");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects progressType=correction with undefined errors (domain guard)", async () => {
    const admin = rpcClient({ data: "should-not-be-called" });
    const out = await recordProgress(admin, {
      bookingId: "b1",
      progressType: "correction",
      range: null,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("error");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("accepts progressType=correction when at least one error is present", async () => {
    const admin = rpcClient({ data: "prog-corr-1" });
    const out = await recordProgress(admin, {
      bookingId: "b1",
      progressType: "correction",
      range: null,
      errors: [{ surahNum: 1, ayahNum: 1, errorType: "makharij", note: null }],
    });
    expect(out).toEqual({ ok: true, progressId: "prog-corr-1" });
  });
});

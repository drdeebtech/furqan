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
});

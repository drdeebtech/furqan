import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Minimal chain fake: from().select().eq().returns() resolves to the last row set.
const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getStudentSessionPrep } from "./teacher-session-prep";

const STUDENT = "student-1";
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
});

describe("getStudentSessionPrep", () => {
  it("returns empty metrics when the student has no errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out).toEqual({ topErrorTypes: [], repeatOffenderAyahs: [] });
  });

  it("ranks the top 3 error types by count (distinct counts, no tie)", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        // madd × 3
        { error_type: "madd", surah_num: 2, ayah_num: 10, note: null, created_at: iso(1) },
        { error_type: "madd", surah_num: 2, ayah_num: 11, note: null, created_at: iso(2) },
        { error_type: "madd", surah_num: 2, ayah_num: 12, note: null, created_at: iso(3) },
        // makharij × 2
        { error_type: "makharij", surah_num: 1, ayah_num: 5, note: null, created_at: iso(4) },
        { error_type: "makharij", surah_num: 1, ayah_num: 6, note: null, created_at: iso(5) },
        // ghunna × 1 — 3rd place
        { error_type: "ghunna", surah_num: 3, ayah_num: 8, note: null, created_at: iso(6) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.topErrorTypes).toEqual([
      { category: "madd", count: 3 },
      { category: "makharij", count: 2 },
      { category: "ghunna", count: 1 },
    ]);
  });

  it("caps at 3 types; count ties break by canonical category order (makharij<sifat<madd<waqf<ghunna<other)", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { error_type: "madd", surah_num: 2, ayah_num: 10, note: null, created_at: iso(1) },
        { error_type: "madd", surah_num: 2, ayah_num: 11, note: null, created_at: iso(2) },
        { error_type: "makharij", surah_num: 1, ayah_num: 5, note: null, created_at: iso(3) },
        { error_type: "makharij", surah_num: 1, ayah_num: 6, note: null, created_at: iso(4) },
        // sifat and ghunna both count 1 → sifat wins the 3rd slot (earlier in canonical order)
        { error_type: "sifat", surah_num: 4, ayah_num: 9, note: null, created_at: iso(5) },
        { error_type: "ghunna", surah_num: 3, ayah_num: 8, note: null, created_at: iso(6) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.topErrorTypes).toEqual([
      { category: "makharij", count: 2 },
      { category: "madd", count: 2 },
      { category: "sifat", count: 1 },
    ]);
  });

  it("excludes errors older than 90 days AND the no-errors sentinel from the type breakdown", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { error_type: "madd", surah_num: 2, ayah_num: 10, note: null, created_at: iso(10) }, // recent → counts
        { error_type: "madd", surah_num: 2, ayah_num: 10, note: null, created_at: iso(120) }, // >90d → excluded
        { error_type: "waqf", surah_num: 2, ayah_num: 10, note: "__no_errors_observed_sentinel__", created_at: iso(1) }, // sentinel → excluded
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.topErrorTypes).toEqual([{ category: "madd", count: 1 }]);
  });

  it("folds inherited object-key error types into other", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { error_type: "constructor", surah_num: 2, ayah_num: 10, note: null, created_at: iso(1) },
        { error_type: "toString", surah_num: 2, ayah_num: 11, note: null, created_at: iso(2) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.topErrorTypes).toEqual([{ category: "other", count: 2 }]);
  });

  it("flags repeat-offender ayahs (>=2) ALL-TIME, even across the 90-day boundary", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        // 2:255 — one recent, one 200 days ago → repeat offender (all-time, count 2)
        { error_type: "madd", surah_num: 2, ayah_num: 255, note: null, created_at: iso(1) },
        { error_type: "makharij", surah_num: 2, ayah_num: 255, note: null, created_at: iso(200) },
        // 1:5 — single error → not a repeat offender
        { error_type: "sifat", surah_num: 1, ayah_num: 5, note: null, created_at: iso(2) },
        // 114:6 — three errors → repeat offender, sorts first (highest count)
        { error_type: "madd", surah_num: 114, ayah_num: 6, note: null, created_at: iso(3) },
        { error_type: "madd", surah_num: 114, ayah_num: 6, note: null, created_at: iso(4) },
        { error_type: "madd", surah_num: 114, ayah_num: 6, note: null, created_at: iso(5) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.repeatOffenderAyahs).toEqual([
      { surah: 114, ayah: 6, count: 3 },
      { surah: 2, ayah: 255, count: 2 },
    ]);
  });

  it("excludes invalid surah:ayah coordinates from the repeat-offender tally", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        // 114:7 is out of range and must be dropped even when repeated.
        { error_type: "madd", surah_num: 114, ayah_num: 7, note: null, created_at: iso(1) },
        { error_type: "madd", surah_num: 114, ayah_num: 7, note: null, created_at: iso(2) },
        // Surah 115 is invalid and must also be dropped when repeated.
        { error_type: "madd", surah_num: 115, ayah_num: 1, note: null, created_at: iso(3) },
        { error_type: "madd", surah_num: 115, ayah_num: 1, note: null, created_at: iso(4) },
        // 114:6 is valid and remains a repeat offender.
        { error_type: "madd", surah_num: 114, ayah_num: 6, note: null, created_at: iso(5) },
        { error_type: "madd", surah_num: 114, ayah_num: 6, note: null, created_at: iso(6) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.repeatOffenderAyahs).toEqual([{ surah: 114, ayah: 6, count: 2 }]);
  });

  it("drops sentinel and null-surah rows from the repeat-offender tally", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        // null surah repeated → cannot render surah:ayah, must be dropped even though count>=2
        { error_type: "other", surah_num: null, ayah_num: 7, note: null, created_at: iso(1) },
        { error_type: "other", surah_num: null, ayah_num: 7, note: null, created_at: iso(2) },
        // sentinel repeated → not a real error, dropped
        { error_type: "other", surah_num: 5, ayah_num: 3, note: "__no_errors_observed_sentinel__", created_at: iso(1) },
        { error_type: "other", surah_num: 5, ayah_num: 3, note: "__no_errors_observed_sentinel__", created_at: iso(2) },
      ],
      error: null,
    });
    const out = await getStudentSessionPrep(chain as never, STUDENT);
    expect(out.repeatOffenderAyahs).toEqual([]);
  });

  it("throws when the query errors so the caller can log + fall back", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getStudentSessionPrep(chain as never, STUDENT)).rejects.toMatchObject({ message: "boom" });
  });
});

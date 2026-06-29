import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./quran-ranges", () => ({
  getLevelBoundaries: vi.fn().mockReturnValue({ start: "78:1", end: "78:20" }),
}));
vi.mock("@/lib/quran/juz-boundaries", () => ({
  getJuzBoundary: vi.fn().mockReturnValue({ startSurah: 1, startAyah: 1, endSurah: 2, endAyah: 141 }),
}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// Chainable Supabase mock — methods return `chain` so queries can be built fluently.
// Leaf methods (maybeSingle, single) are stubbed per-test via mockResolvedValueOnce.
const chain: Record<string, ReturnType<typeof vi.fn>> = {
  from: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  neq: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
};
for (const key of ["from", "select", "insert", "update", "delete", "eq", "neq"]) {
  chain[key].mockReturnValue(chain);
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => chain),
}));

import { issueCertificate } from "./issue";

const STUDENT = "student-aaa";
const TYPE = "appreciation_level" as const;
const MILESTONE = "78";

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire chain after clearAllMocks (resets call counts but not mockReturnValue).
  for (const key of ["from", "select", "insert", "update", "delete", "eq", "neq"]) {
    chain[key].mockReturnValue(chain);
  }
});

describe("issueCertificate", () => {
  it("fresh issue: no existing log → issues cert and returns idempotent=false", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }); // log query (no existing row)

    // Lock insert now uses insert().select("id").single() — one round-trip, no separate fetch.
    const certRow = {
      id: "cert-1",
      student_id: STUDENT,
      certificate_type: TYPE,
      milestone_key: MILESTONE,
      cited_range_start: "78:1",
      cited_range_end: "78:20",
      issued_at: "2026-01-01T00:00:00Z",
    };
    chain.single
      .mockResolvedValueOnce({ data: { id: "log-1" }, error: null }) // lock insert → id
      .mockResolvedValueOnce({ data: certRow, error: null }); // cert insert → row

    chain.update.mockReturnValue(chain); // log update chain

    const result = await issueCertificate(STUDENT, TYPE, MILESTONE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(false);
      expect(result.certificate.id).toBe("cert-1");
    }
  });

  it("idempotent: existing log status='succeeded' → returns existing cert without re-issuing", async () => {
    const certRow = {
      id: "cert-existing",
      student_id: STUDENT,
      certificate_type: TYPE,
      milestone_key: MILESTONE,
      cited_range_start: "78:1",
      cited_range_end: "78:20",
      issued_at: "2026-01-01T00:00:00Z",
    };
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: "log-1", status: "succeeded" }, error: null }) // log query
      .mockResolvedValueOnce({ data: certRow, error: null }); // cert lookup

    const result = await issueCertificate(STUDENT, TYPE, MILESTONE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(true);
      expect(result.certificate.id).toBe("cert-existing");
    }
    // Must NOT attempt a new cert insert.
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("in-flight: log status='started' but cert not yet in DB → returns error (not synthetic row)", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: "log-started", status: "started" }, error: null }) // log query
      .mockResolvedValueOnce({ data: null, error: null }); // cert lookup → not found yet

    const result = await issueCertificate(STUDENT, TYPE, MILESTONE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("concurrent issuance in progress");
    }
    // Must NOT attempt a new cert insert.
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("appreciation_juz: malformed milestone_key with trailing chars → fails with invalid key error", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }); // log query → no existing
    chain.single
      .mockResolvedValueOnce({ data: { id: "log-1" }, error: null }); // lock insert → id
    chain.update.mockReturnValue(chain); // markFailed chain

    const result = await issueCertificate(STUDENT, "appreciation_juz", "3abc");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid juz milestone_key/);
    }
    // Lock was acquired but no cert insert attempted.
    expect(chain.insert).toHaveBeenCalledTimes(1);
  });

  it("failed-row retry (#491): failed rows are invisible to the lock query → fresh issue, no delete", async () => {
    // Since #491 the lock query is `.neq("status","failed")`, so accumulated
    // failed rows never surface — maybeSingle returns null and the flow inserts
    // a fresh 'started' row. The partial UNIQUE index lets the new row coexist
    // with the stale failed rows, so the old delete-and-retry workaround is gone.
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }); // log query (failed rows filtered out)

    const certRow = {
      id: "cert-retry",
      student_id: STUDENT,
      certificate_type: TYPE,
      milestone_key: MILESTONE,
      cited_range_start: "78:1",
      cited_range_end: "78:20",
      issued_at: "2026-01-01T00:00:00Z",
    };
    chain.single
      .mockResolvedValueOnce({ data: { id: "log-new" }, error: null }) // lock insert → id
      .mockResolvedValueOnce({ data: certRow, error: null }); // cert insert → row
    chain.update.mockReturnValue(chain);

    const result = await issueCertificate(STUDENT, TYPE, MILESTONE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(false);
      expect(result.certificate.id).toBe("cert-retry");
    }
    // No delete — failed rows are retained as an audit trail.
    expect(chain.delete).not.toHaveBeenCalled();
  });
});

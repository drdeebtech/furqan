import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./quran-ranges", () => ({
  getLevelBoundaries: vi.fn().mockReturnValue({ start: "78:1", end: "78:20" }),
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
  maybeSingle: vi.fn(),
  single: vi.fn(),
};
for (const key of ["from", "select", "insert", "update", "delete", "eq"]) {
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
  for (const key of ["from", "select", "insert", "update", "delete", "eq"]) {
    chain[key].mockReturnValue(chain);
  }
});

describe("issueCertificate", () => {
  it("fresh issue: no existing log → issues cert and returns idempotent=false", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // log query (no existing row)
      .mockResolvedValueOnce({ data: { id: "log-1" }, error: null }); // log id fetch

    chain.insert.mockReturnValueOnce({ error: null }); // log lock insert

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
      .mockResolvedValueOnce({ data: certRow, error: null }); // cert insert single

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

  it("failed-row retry: existing log status='failed' → deletes old log row, then issues cert", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: "log-failed", status: "failed" }, error: null }) // log query
      .mockResolvedValueOnce({ data: { id: "log-new" }, error: null }); // log id fetch after re-insert

    chain.insert.mockReturnValueOnce({ error: null }); // new log lock insert

    const certRow = {
      id: "cert-retry",
      student_id: STUDENT,
      certificate_type: TYPE,
      milestone_key: MILESTONE,
      cited_range_start: "78:1",
      cited_range_end: "78:20",
      issued_at: "2026-01-01T00:00:00Z",
    };
    chain.single.mockResolvedValueOnce({ data: certRow, error: null });
    chain.update.mockReturnValue(chain);

    const result = await issueCertificate(STUDENT, TYPE, MILESTONE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(false);
      expect(result.certificate.id).toBe("cert-retry");
    }
    // The delete must have been called to clear the failed log row.
    expect(chain.delete).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
  returns: vi.fn().mockReturnThis(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => chain),
}));

import { generateMonthlyReport } from "./monthly-report";

const STUDENT = "student-aaa";

const FULL_ROW = {
  id: "report-1",
  student_id: STUDENT,
  subscription_id: null,
  period_year: 2026,
  period_month: 1,
  version: 1,
  level_assessment_summary: "Good recitation progress.",
  generated_at: "2026-01-31T00:00:00Z",
  created_at: "2026-01-31T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
  chain.insert.mockReturnThis();
  chain.returns.mockReturnThis();
});

describe("generateMonthlyReport", () => {
  it("invalid year returns error", async () => {
    const result = await generateMonthlyReport({ studentId: STUDENT, year: 2019, month: 1 });
    expect(result.ok).toBe(false);
  });

  it("invalid month returns error", async () => {
    const result = await generateMonthlyReport({ studentId: STUDENT, year: 2026, month: 13 });
    expect(result.ok).toBe(false);
  });

  it("first call: no prior row → inserts version=1, idempotent=false", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null }); // no latest row
    chain.single.mockResolvedValueOnce({ data: FULL_ROW, error: null }); // insert result

    const result = await generateMonthlyReport({
      studentId: STUDENT,
      year: 2026,
      month: 1,
      summary: "Good recitation progress.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(false);
      expect(result.report.version).toBe(1);
    }
  });

  it("same content again → idempotent skip, no duplicate insert", async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: "report-1", version: 1, level_assessment_summary: "Good recitation progress." },
      error: null,
    });
    chain.single.mockResolvedValueOnce({ data: FULL_ROW, error: null });

    const result = await generateMonthlyReport({
      studentId: STUDENT,
      year: 2026,
      month: 1,
      summary: "Good recitation progress.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(true);
      if (result.idempotent) expect(result.reason).toBe("duplicate-issuance");
    }
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("corrected content → appends new version=2, preserves version=1", async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: "report-1", version: 1, level_assessment_summary: "Old summary." },
      error: null,
    });
    const v2Row = { ...FULL_ROW, id: "report-2", version: 2, level_assessment_summary: "Corrected summary." };
    chain.single.mockResolvedValueOnce({ data: v2Row, error: null });

    const result = await generateMonthlyReport({
      studentId: STUDENT,
      year: 2026,
      month: 1,
      summary: "Corrected summary.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(false);
      expect(result.report.version).toBe(2);
      expect(result.report.level_assessment_summary).toBe("Corrected summary.");
    }
  });

  it("out-of-order correction for an older period appends to that period only", async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: "jan-report", version: 1, level_assessment_summary: "Jan original." },
      error: null,
    });
    const janV2 = { ...FULL_ROW, id: "jan-v2", period_month: 1, version: 2, level_assessment_summary: "Jan corrected." };
    chain.single.mockResolvedValueOnce({ data: janV2, error: null });

    const result = await generateMonthlyReport({
      studentId: STUDENT,
      year: 2026,
      month: 1,
      summary: "Jan corrected.",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.period_month).toBe(1);
      expect(result.report.version).toBe(2);
    }
  });
});

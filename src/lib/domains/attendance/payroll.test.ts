import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));

import { runMonthlyPayroll, getPayouts } from "./payroll";

describe("runMonthlyPayroll", () => {
  const mockAdmin = {
    rpc: vi.fn(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payoutsCreated count from RPC + empty exceptions when no offenders", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({ data: 3, error: null });
    mockAdmin.eq.mockResolvedValueOnce({ data: [], error: null }); // session_deliveries select

    const result = await runMonthlyPayroll(
      mockAdmin as unknown as SupabaseClient<Database>,
      "2026-06-01",
    );
    expect(result.payoutsCreated).toBe(3);
    expect(result.exceptions).toEqual([]);
  });

  it("surfaces missing_or_zero_rate exception (FR-030)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({ data: 0, error: null });
    mockAdmin.eq.mockResolvedValueOnce({
      // Teacher with $0 rate deliveries — must NOT yield a $0 payout.
      data: [{ teacher_id: "teacher-zero", hourly_rate_usd: "0" }],
      error: null,
    });

    const result = await runMonthlyPayroll(
      mockAdmin as unknown as SupabaseClient<Database>,
      "2026-06-01",
    );
    expect(result.payoutsCreated).toBe(0);
    expect(result.exceptions).toContainEqual({
      teacherId: "teacher-zero",
      reason: "missing_or_zero_rate",
    });
  });

  it("surfaces non_uniform_rate exception (FR-029)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({ data: 0, error: null });
    mockAdmin.eq.mockResolvedValueOnce({
      // Same teacher, two different rates across the month — MUST NOT be MAX-picked.
      data: [
        { teacher_id: "teacher-mixed", hourly_rate_usd: "20.00" },
        { teacher_id: "teacher-mixed", hourly_rate_usd: "25.00" },
      ],
      error: null,
    });

    const result = await runMonthlyPayroll(
      mockAdmin as unknown as SupabaseClient<Database>,
      "2026-06-01",
    );
    expect(result.exceptions).toContainEqual({
      teacherId: "teacher-mixed",
      reason: "non_uniform_rate",
    });
  });

  it("rethrows RPC errors (no silent failure)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "function crashed" },
    });
    await expect(
      runMonthlyPayroll(mockAdmin as unknown as SupabaseClient<Database>, "2026-06-01"),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

describe("getPayouts", () => {
  const mockClient = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies teacherId filter when provided", async () => {
    mockClient.order.mockResolvedValueOnce({ data: [], error: null });
    await getPayouts(mockClient as unknown as SupabaseClient<Database>, {
      teacherId: "teacher-1",
    });
    expect(mockClient.eq).toHaveBeenCalledWith("teacher_id", "teacher-1");
  });

  it("returns rows from the query", async () => {
    const rows = [{ id: "p1", teacher_id: "t1", total_amount_usd: "60.00" }];
    mockClient.order.mockResolvedValueOnce({ data: rows, error: null });
    const result = await getPayouts(mockClient as unknown as SupabaseClient<Database>, {});
    expect(result).toBe(rows);
  });

  it("rethrows query errors", async () => {
    mockClient.order.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "RLS denied" },
    });
    await expect(
      getPayouts(mockClient as unknown as SupabaseClient<Database>, {}),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

/**
 * Unit tests for the teacher-search zod boundary (spec 036, eng-review 2026-07-19).
 *
 * The RPC's SQL behavior (visibility gates, materialized rating_count, private-
 * review counting policy) is proven by scripts/walk-teacher-rating-count.sql
 * against the real local DB — these tests pin the TypeScript boundary: what the
 * public API route will and will not accept, and the defaults it applies.
 */
import { describe, it, expect, vi } from "vitest";

// `server-only` throws outside a server bundle — no-op for the test runner
// (same pattern as admin.test.ts; pulled in via createAdminClient).
vi.mock("server-only", () => ({}));
import { TeacherSearchParamsSchema } from "./teacher-search";

describe("TeacherSearchParamsSchema", () => {
  it("applies page/limit defaults on an empty query", () => {
    const parsed = TeacherSearchParamsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(12);
  });

  it("coerces numeric strings (URL search params are strings)", () => {
    const parsed = TeacherSearchParamsSchema.parse({
      page: "3", limit: "24", price_min: "10", price_max: "40",
    });
    expect(parsed).toMatchObject({ page: 3, limit: 24, price_min: 10, price_max: 40 });
  });

  it("caps limit at 50 (a limit=500 request must not reach the DB)", () => {
    expect(TeacherSearchParamsSchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("caps page at 1000 (unbounded pages become huge OFFSETs)", () => {
    // 1001 pins the cap exactly (999999 alone would still pass a cap of 5000).
    expect(TeacherSearchParamsSchema.safeParse({ page: "1001" }).success).toBe(false);
    expect(TeacherSearchParamsSchema.safeParse({ page: "999999" }).success).toBe(false);
    expect(TeacherSearchParamsSchema.safeParse({ page: "1000" }).success).toBe(true);
  });

  it("rejects page 0 and negative/fractional pages", () => {
    expect(TeacherSearchParamsSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(TeacherSearchParamsSchema.safeParse({ page: "-1" }).success).toBe(false);
    expect(TeacherSearchParamsSchema.safeParse({ page: "1.5" }).success).toBe(false);
  });

  it("rejects an inverted price range (min > max) via the refine", () => {
    expect(
      TeacherSearchParamsSchema.safeParse({ price_min: "50", price_max: "10" }).success,
    ).toBe(false);
  });

  it("accepts an equal price range (min == max is a valid exact-price filter)", () => {
    expect(
      TeacherSearchParamsSchema.safeParse({ price_min: "25", price_max: "25" }).success,
    ).toBe(true);
  });

  it("rejects negative prices", () => {
    expect(TeacherSearchParamsSchema.safeParse({ price_min: "-5" }).success).toBe(false);
  });

  it("restricts gender to the male/female enum", () => {
    expect(TeacherSearchParamsSchema.safeParse({ gender: "female" }).success).toBe(true);
    expect(TeacherSearchParamsSchema.safeParse({ gender: "other" }).success).toBe(false);
  });

  it("rejects an over-long query string (max 200 chars)", () => {
    expect(TeacherSearchParamsSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(TeacherSearchParamsSchema.safeParse({ q: "x".repeat(200) }).success).toBe(true);
  });
});

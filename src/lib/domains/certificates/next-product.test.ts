import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const mocks = vi.hoisted(() => {
  const enrollChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  const coursesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  const fromMock = vi.fn((table: string) => {
    if (table === "course_enrollments") return enrollChain;
    return coursesChain;
  });
  return { enrollChain, coursesChain, fromMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.fromMock })),
}));

import { suggestNextProduct } from "./next-product";

const STUDENT = "student-aaa";
const COMPLETED = "course-completed";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enrollChain.select.mockReturnThis();
  mocks.enrollChain.eq.mockReturnThis();
  mocks.coursesChain.select.mockReturnThis();
  mocks.coursesChain.eq.mockReturnThis();
  mocks.coursesChain.is.mockReturnThis();
  mocks.coursesChain.order.mockReturnThis();
  mocks.coursesChain.limit.mockReturnThis();
  mocks.fromMock.mockImplementation((table: string) => {
    if (table === "course_enrollments") return mocks.enrollChain;
    return mocks.coursesChain;
  });
});

describe("suggestNextProduct", () => {
  it("returns next unenrolled course", async () => {
    mocks.enrollChain.eq.mockResolvedValueOnce({ data: [{ course_id: COMPLETED }], error: null });
    const courseB = { id: "course-b", title_ar: "كورس ب", title_en: "Course B", price_cents: 2000, currency: "usd" };
    mocks.coursesChain.limit.mockResolvedValueOnce({ data: [courseB], error: null });

    const result = await suggestNextProduct(STUDENT, COMPLETED);
    expect(result?.id).toBe("course-b");
  });

  it("returns null when all courses already enrolled (degrade-to-neutral)", async () => {
    const courseA = { id: COMPLETED, title_ar: "كورس أ", title_en: null, price_cents: 1000, currency: "usd" };
    mocks.enrollChain.eq.mockResolvedValueOnce({ data: [{ course_id: COMPLETED }], error: null });
    mocks.coursesChain.limit.mockResolvedValueOnce({ data: [courseA], error: null });

    const result = await suggestNextProduct(STUDENT, COMPLETED);
    expect(result).toBeNull();
  });

  it("returns null on enrollment DB error (degrade-to-neutral, never fabricate)", async () => {
    mocks.enrollChain.eq.mockResolvedValueOnce({ data: null, error: { message: "db error" } });

    const result = await suggestNextProduct(STUDENT, COMPLETED);
    expect(result).toBeNull();
  });

  it("returns null on courses DB error (degrade-to-neutral)", async () => {
    mocks.enrollChain.eq.mockResolvedValueOnce({ data: [], error: null });
    mocks.coursesChain.limit.mockResolvedValueOnce({ data: null, error: { message: "db error" } });

    const result = await suggestNextProduct(STUDENT, COMPLETED);
    expect(result).toBeNull();
  });

  it("returns null when no published courses exist", async () => {
    mocks.enrollChain.eq.mockResolvedValueOnce({ data: [], error: null });
    mocks.coursesChain.limit.mockResolvedValueOnce({ data: [], error: null });

    const result = await suggestNextProduct(STUDENT, COMPLETED);
    expect(result).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { z } from "zod";

const gradeFollowUpSchema = z.object({
  homeworkId: z.string().uuid(),
  grade: z.enum(["completed_excellent", "completed_good", "completed_needs_work", "completed_not_done"]),
  teacher_notes: z.string().nullable(),
});

const editFollowUpUpdatesSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  homework_type: z.string().optional(),
  surah_number: z.number().nullable().optional(),
  ayah_start: z.number().nullable().optional(),
  ayah_end: z.number().nullable().optional(),
  pages_count: z.number().nullable().optional(),
  due_date: z.string().nullable().optional(),
  teacher_notes: z.string().nullable().optional(),
}).strip();

describe("gradeFollowUp Zod schema (M2)", () => {
  it("accepts a valid grade", () => {
    const result = gradeFollowUpSchema.safeParse({
      homeworkId: "00000000-0000-0000-0000-000000000000",
      grade: "completed_good",
      teacher_notes: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid grade like 'bogus'", () => {
    const result = gradeFollowUpSchema.safeParse({
      homeworkId: "00000000-0000-0000-0000-000000000000",
      grade: "bogus",
      teacher_notes: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("grade"))).toBe(true);
    }
  });

  it("rejects a non-grade status like 'assigned'", () => {
    const result = gradeFollowUpSchema.safeParse({
      homeworkId: "00000000-0000-0000-0000-000000000000",
      grade: "assigned",
      teacher_notes: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("editFollowUp updates Zod schema (M3 strip)", () => {
  it("strips injected status and teacher_id from updates", () => {
    const result = editFollowUpUpdatesSchema.safeParse({
      title: "new title",
      status: "completed_good",
      teacher_id: "malicious-id",
      student_id: "malicious-student",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: "new title" });
      expect("status" in result.data).toBe(false);
      expect("teacher_id" in result.data).toBe(false);
      expect("student_id" in result.data).toBe(false);
    }
  });

  it("preserves legitimate editable fields", () => {
    const input = {
      title: "updated",
      description: "desc",
      homework_type: "hifz",
      surah_number: 2,
      ayah_start: 1,
      ayah_end: 10,
      pages_count: 5,
      due_date: "2026-07-01",
      teacher_notes: "notes",
    };
    const result = editFollowUpUpdatesSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });
});

const progressSchema = z.object({
  sessionId: z.string().uuid(),
  bookingId: z.string().uuid(),
  progressType: z.enum(["new", "muraja", "correction"]),
  surahFrom: z.number().int().nullable(),
  ayahFrom: z.number().int().nullable(),
  surahTo: z.number().int().nullable(),
  ayahTo: z.number().int().nullable(),
  pagesReviewed: z.number().int().nonnegative().nullable().optional(),
  qualityRating: z.number().int().min(1).max(5).nullable().optional(),
  level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  teacherNotes: z.string().nullable().optional(),
  errors: z.array(z.object({
    surahNum: z.number().int(),
    ayahNum: z.number().int(),
    errorType: z.enum(["makharij", "sifat", "madd", "waqf", "ghunna", "other"]),
    note: z.string().nullable().optional(),
  })).optional(),
});

describe("recordSessionProgress Zod schema (M1 boundary)", () => {
  it("rejects a non-integer ayahFrom", () => {
    const result = progressSchema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000000",
      bookingId: "00000000-0000-0000-0000-000000000000",
      progressType: "new",
      surahFrom: 2,
      ayahFrom: 1.5,
      surahTo: 2,
      ayahTo: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("ayahFrom"))).toBe(true);
    }
  });

  it("rejects an invalid progressType", () => {
    const result = progressSchema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000000",
      bookingId: "00000000-0000-0000-0000-000000000000",
      progressType: "invalid",
      surahFrom: null,
      ayahFrom: null,
      surahTo: null,
      ayahTo: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("progressType"))).toBe(true);
    }
  });

  it("rejects qualityRating out of range (0)", () => {
    const result = progressSchema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000000",
      bookingId: "00000000-0000-0000-0000-000000000000",
      progressType: "muraja",
      surahFrom: null,
      ayahFrom: null,
      surahTo: null,
      ayahTo: null,
      qualityRating: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid input", () => {
    const result = progressSchema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000000",
      bookingId: "00000000-0000-0000-0000-000000000000",
      progressType: "new",
      surahFrom: 2,
      ayahFrom: 1,
      surahTo: 2,
      ayahTo: 286,
      qualityRating: 4,
      level: "intermediate",
    });
    expect(result.success).toBe(true);
  });
});

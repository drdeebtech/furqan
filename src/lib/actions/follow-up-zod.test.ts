import { describe, it, expect } from "vitest";
import {
  gradeFollowUpSchema,
  editFollowUpUpdatesSchema,
} from "@/lib/actions/follow-up-schemas";
import { recordSessionProgressSchema } from "@/lib/actions/progress-schemas";

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

const progressSchema = recordSessionProgressSchema;

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

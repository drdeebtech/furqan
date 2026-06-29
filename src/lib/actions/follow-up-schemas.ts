import { z } from "zod";

// Talqeen review (#541): tajweed errors captured while grading a homework
// recitation. Mirrors the live-session `CapturedError` shape; surah/ayah are
// re-validated against canonical ayah counts in the domain before insert.
export const capturedErrorSchema = z.object({
  surahNum: z.number().int().min(1).max(114),
  ayahNum: z.number().int().min(1).max(286),
  errorType: z.enum(["makharij", "sifat", "madd", "waqf", "ghunna", "other"]),
  note: z.string().max(500).nullable().optional(),
});

export const gradeFollowUpSchema = z.object({
  homeworkId: z.string().uuid(),
  grade: z.enum([
    "completed_excellent",
    "completed_good",
    "completed_needs_work",
    "completed_not_done",
  ]),
  teacher_notes: z.string().nullable(),
  // `.nullable()` so callers following GradeFollowUpInput (errors?: … | null)
  // validate cleanly instead of failing before the handler runs. (#541 CR)
  errors: z.array(capturedErrorSchema).max(50).nullable().optional(),
});

export const editFollowUpUpdatesSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    homework_type: z.string().optional(),
    surah_number: z.number().nullable().optional(),
    ayah_start: z.number().nullable().optional(),
    ayah_end: z.number().nullable().optional(),
    pages_count: z.number().nullable().optional(),
    due_date: z.string().nullable().optional(),
    teacher_notes: z.string().nullable().optional(),
  })
  .strip();

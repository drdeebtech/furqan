import { z } from "zod";

export const gradeFollowUpSchema = z.object({
  homeworkId: z.string().uuid(),
  grade: z.enum([
    "completed_excellent",
    "completed_good",
    "completed_needs_work",
    "completed_not_done",
  ]),
  teacher_notes: z.string().nullable(),
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

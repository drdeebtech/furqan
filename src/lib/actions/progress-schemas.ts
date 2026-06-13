import { z } from "zod";

export const recordSessionProgressSchema = z.object({
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
  teacherNotes: z.string().max(5000).nullable().optional(),
  errors: z
    .array(
      z.object({
        surahNum: z.number().int(),
        ayahNum: z.number().int(),
        errorType: z.enum([
          "makharij",
          "sifat",
          "madd",
          "waqf",
          "ghunna",
          "other",
        ]),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .max(500)
    .optional(),
});

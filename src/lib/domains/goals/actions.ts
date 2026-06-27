"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { routeAction } from "@/lib/actions/route-action";
import { UserError } from "@/lib/actions/user-error";
import { validateRange, violationMessageAr } from "@/lib/domains/progress/validation";
import { surahName } from "@/lib/quran/surahs";
import { createClient } from "@/lib/supabase/server";
import { upsertGoal } from "./goals";

const goalFields = {
  surahStart: z.number().int(),
  ayahStart: z.number().int(),
  surahEnd: z.number().int(),
  ayahEnd: z.number().int(),
  targetDate: z.string().date(),
};

const studentGoalSchema = z.object(goalFields);
const teacherGoalSchema = studentGoalSchema.extend({ studentId: z.string().uuid() });

function assertGoalInput(input: z.infer<typeof studentGoalSchema>): void {
  const violation = validateRange({
    surahFrom: input.surahStart,
    ayahFrom: input.ayahStart,
    surahTo: input.surahEnd,
    ayahTo: input.ayahEnd,
  });
  if (violation) {
    throw new UserError(violationMessageAr(violation, (number) => surahName(number, "ar")));
  }
  if (input.targetDate < new Date().toISOString().slice(0, 10)) {
    throw new UserError("تاريخ الهدف لا يمكن أن يكون في الماضي.");
  }
}

export const setStudentGoal = routeAction({
  name: "student.goal.set",
  role: "student",
  schema: studentGoalSchema,
  handler: async (input, { actorId }) => {
    assertGoalInput(input);
    const client = await createClient();
    await upsertGoal(client, {
      student_id: actorId!,
      surah_start: input.surahStart,
      ayah_start: input.ayahStart,
      surah_end: input.surahEnd,
      ayah_end: input.ayahEnd,
      target_date: input.targetDate,
    });
    revalidatePath("/student/dashboard");
    return { message: "تم حفظ هدفك" };
  },
});

export const setTeacherStudentGoal = routeAction({
  name: "teacher.studentGoal.set",
  role: "teacher",
  schema: teacherGoalSchema,
  handler: async (input) => {
    assertGoalInput(input);
    const client = await createClient();
    await upsertGoal(client, {
      student_id: input.studentId,
      surah_start: input.surahStart,
      ayah_start: input.ayahStart,
      surah_end: input.surahEnd,
      ayah_end: input.ayahEnd,
      target_date: input.targetDate,
    });
    revalidatePath(`/teacher/students/${input.studentId}`);
    revalidatePath("/student/dashboard");
    return { message: "تم حفظ هدف الطالب" };
  },
});

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction } from "@/lib/actions/loud";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import { createEvaluationRecord } from "@/lib/domains/progress/actions";
import { UserError } from "@/lib/actions/user-error";

// Tagged error wrapper for "user-mistake-not-infra-fault" throws (missing
// fields, IDOR rejection, missing permission). loudAction routes these
// through audit_log marked FAILED so security telemetry survives, but
// Sentry queries can filter via tag = "user-error" to keep noise out of
// infra dashboards. Same pattern as account.ts (PR #250).

type ActionResult = { error?: string; success?: boolean };

// Verify caller is admin. Throws UserError on rejection so loudAction
// records audit_log + Sentry breadcrumb. ADR-0003 dropped the moderator
// role; admin is the only allowed value.
async function requireAdminActor(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") throw new UserError("غير مصرح");
  return { actorId: user.id };
}

const EVAL_TYPES = ["weekly", "biweekly", "monthly", "quarterly"] as const;

const createEvaluationSchema = z.object({
  student_id: z.string().uuid("معرّف الطالب غير صالح"),
  teacher_id: z.string().uuid("معرّف المعلم غير صالح"),
  evaluation_type: z.enum(EVAL_TYPES),
  evaluation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  hifz_score: z.number().nullable(),
  tajweed_score: z.number().nullable(),
  fluency_score: z.number().nullable(),
  attendance_score: z.number().nullable(),
  overall_score: z.number().nullable(),
  strengths: z.string().nullable(),
  areas_for_improvement: z.string().nullable(),
  next_goals: z.string().nullable(),
  teacher_comments: z.string().nullable(),
});

const createEvaluationBase = loudAction<z.infer<typeof createEvaluationSchema>, { message: string }>({
  name: "evaluation.create",
  severity: "warning",
  schema: createEvaluationSchema,
  audit: {
    table: "session_evaluations",
    recordId: (i) => i.student_id,
    action: "INSERT",
  },
  preflight: requireAdminActor,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();

    await createEvaluationRecord(supabase, {
      studentId: input.student_id,
      teacherId: input.teacher_id,
      evaluationType: input.evaluation_type,
      evaluationDate: input.evaluation_date,
      scores: {
        hifz: input.hifz_score,
        tajweed: input.tajweed_score,
        fluency: input.fluency_score,
        attendance: input.attendance_score,
        overall: input.overall_score,
      },
      text: {
        strengths: input.strengths,
        areasForImprovement: input.areas_for_improvement,
        nextGoals: input.next_goals,
        teacherComments: input.teacher_comments,
      },
      actor: { id: actorId as string, role: "admin" },
    });

    revalidatePath("/admin/evaluations");
    revalidatePath("/teacher/evaluations");

    return { message: "تم إنشاء التقييم بنجاح" };
  },
});

export async function createEvaluation(formData: FormData): Promise<ActionResult> {
  const num = (key: string): number | null => {
    const v = formData.get(key);
    return v ? Number(v) : null;
  };
  const str = (key: string): string | null => {
    const v = formData.get(key);
    return v ? String(v) : null;
  };

  const result = await createEvaluationBase({
    student_id: String(formData.get("student_id") ?? ""),
    teacher_id: String(formData.get("teacher_id") ?? ""),
    evaluation_type: String(formData.get("evaluation_type") ?? "") as z.infer<typeof createEvaluationSchema>["evaluation_type"],
    evaluation_date: String(formData.get("evaluation_date") ?? ""),
    hifz_score: num("hifz_score"),
    tajweed_score: num("tajweed_score"),
    fluency_score: num("fluency_score"),
    attendance_score: num("attendance_score"),
    overall_score: num("overall_score"),
    strengths: str("strengths"),
    areas_for_improvement: str("areas_for_improvement"),
    next_goals: str("next_goals"),
    teacher_comments: str("teacher_comments"),
  });

  if (!result.ok) return { error: result.error };
  return { success: true };
}

// Teacher-friendly version: takes direct params, allows teacher role.
// IDOR guard: a teacher may only evaluate students they actually teach.
const createTeacherEvaluationSchema = z.object({
  studentId: z.string().uuid(),
  evaluationType: z.enum(EVAL_TYPES),
  evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scores: z.object({
    hifz: z.number().optional(),
    tajweed: z.number().optional(),
    fluency: z.number().optional(),
    attendance: z.number().optional(),
    overall: z.number(),
  }),
  text: z.object({
    strengths: z.string().nullable().optional(),
    areas_for_improvement: z.string().nullable().optional(),
    next_goals: z.string().nullable().optional(),
    teacher_comments: z.string().nullable().optional(),
  }),
});

const createTeacherEvaluationBase = loudAction<z.infer<typeof createTeacherEvaluationSchema>, { message: string }>({
  name: "evaluation.create-teacher",
  severity: "warning",
  schema: createTeacherEvaluationSchema,
  audit: {
    table: "session_evaluations",
    recordId: (i) => i.studentId,
    action: "INSERT",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (!profile || !["admin", "teacher"].includes(profile.role)) {
      throw new UserError("ليس لديك صلاحية");
    }
    return { actorId: user.id };
  },
  handler: async (input, { actorId }) => {
    const supabase = await createClient();
    // Re-fetch role inside handler to enforce the IDOR check for teachers.
    // Admin path skips the relation check (legitimate cross-student
    // standing). Without this guard, any logged-in teacher could write a
    // session_evaluations row against an arbitrary student_id.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", actorId as string)
      .single<{ role: string }>();

    // Fail closed: an errored/missing re-fetch must never default to
    // "admin" — that would skip the IDOR relation check below (CodeRabbit
    // finding on PR #771).
    if (profile?.role !== "teacher" && profile?.role !== "admin") {
      throw new UserError("تعذر التحقق من الصلاحية — حاول مرة أخرى");
    }
    const role = profile.role === "teacher" ? ("teacher" as const) : ("admin" as const);

    await createEvaluationRecord(supabase, {
      studentId: input.studentId,
      teacherId: actorId as string,
      evaluationType: input.evaluationType,
      evaluationDate: input.evaluationDate,
      scores: {
        hifz: input.scores.hifz ?? null,
        tajweed: input.scores.tajweed ?? null,
        fluency: input.scores.fluency ?? null,
        attendance: input.scores.attendance ?? null,
        overall: input.scores.overall,
      },
      text: {
        strengths: input.text.strengths ?? null,
        areasForImprovement: input.text.areas_for_improvement ?? null,
        nextGoals: input.text.next_goals ?? null,
        teacherComments: input.text.teacher_comments ?? null,
      },
      actor: { id: actorId as string, role },
    });

    revalidatePath("/teacher/evaluations");
    revalidatePath("/teacher/students");

    return { message: "تم إنشاء التقييم" };
  },
});

export async function createTeacherEvaluation(
  studentId: string,
  evaluationType: string,
  evaluationDate: string,
  scores: { hifz?: number; tajweed?: number; fluency?: number; attendance?: number; overall: number },
  text: { strengths?: string | null; areas_for_improvement?: string | null; next_goals?: string | null; teacher_comments?: string | null },
): Promise<ActionResult> {
  const result = await createTeacherEvaluationBase({
    studentId,
    evaluationType: evaluationType as z.infer<typeof createTeacherEvaluationSchema>["evaluationType"],
    evaluationDate,
    scores,
    text,
  });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const updateEvaluationSchema = z.object({
  evaluationId: z.string().uuid(),
  hifz_score: z.number().nullable().optional(),
  tajweed_score: z.number().nullable().optional(),
  fluency_score: z.number().nullable().optional(),
  attendance_score: z.number().nullable().optional(),
  overall_score: z.number().nullable().optional(),
  strengths: z.string().nullable().optional(),
  areas_for_improvement: z.string().nullable().optional(),
  next_goals: z.string().nullable().optional(),
  teacher_comments: z.string().nullable().optional(),
});

const updateEvaluationBase = loudAction<z.infer<typeof updateEvaluationSchema>, { message: string }>({
  name: "evaluation.update",
  severity: "warning",
  schema: updateEvaluationSchema,
  audit: {
    table: "session_evaluations",
    recordId: (i) => i.evaluationId,
    action: "UPDATE",
  },
  preflight: requireAdminActor,
  handler: async (input) => {
    const supabase = await createClient();

    const updates: TableUpdate<"session_evaluations"> = {};
    for (const key of ["hifz_score", "tajweed_score", "fluency_score", "attendance_score", "overall_score"] as const) {
      const v = input[key];
      if (v !== undefined && v !== null) updates[key] = v;
    }
    for (const key of ["strengths", "areas_for_improvement", "next_goals", "teacher_comments"] as const) {
      const v = input[key];
      if (v !== undefined) updates[key] = v;
    }

    const { error } = await supabase
      .from("session_evaluations")
      .update(updates)
      .eq("id", input.evaluationId);

    if (error) throw error;

    revalidatePath("/admin/evaluations");

    return { message: "تم تحديث التقييم" };
  },
});

export async function updateEvaluation(evaluationId: string, formData: FormData): Promise<ActionResult> {
  const num = (key: string): number | null | undefined => {
    const v = formData.get(key);
    if (v === null) return undefined;
    return v ? Number(v) : null;
  };
  const str = (key: string): string | null | undefined => {
    const v = formData.get(key);
    if (v === null) return undefined;
    return v ? String(v) : null;
  };

  const result = await updateEvaluationBase({
    evaluationId,
    hifz_score: num("hifz_score"),
    tajweed_score: num("tajweed_score"),
    fluency_score: num("fluency_score"),
    attendance_score: num("attendance_score"),
    overall_score: num("overall_score"),
    strengths: str("strengths"),
    areas_for_improvement: str("areas_for_improvement"),
    next_goals: str("next_goals"),
    teacher_comments: str("teacher_comments"),
  });

  if (!result.ok) return { error: result.error };
  return { success: true };
}

// Destructive — severity: critical fires Telegram alert if the delete
// fails. The audit_log row is the recovery source of truth.
const deleteEvaluationBase = loudAction<{ evaluationId: string }, { message: string }>({
  name: "evaluation.delete",
  severity: "critical",
  schema: z.object({ evaluationId: z.string().uuid() }),
  audit: {
    table: "session_evaluations",
    recordId: (i) => i.evaluationId,
    action: "DELETE",
  },
  preflight: requireAdminActor,
  handler: async ({ evaluationId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("session_evaluations")
      .delete()
      .eq("id", evaluationId);
    if (error) throw error;

    revalidatePath("/admin/evaluations");

    return { message: "تم حذف التقييم" };
  },
});

export async function deleteEvaluation(evaluationId: string): Promise<ActionResult> {
  const result = await deleteEvaluationBase({ evaluationId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

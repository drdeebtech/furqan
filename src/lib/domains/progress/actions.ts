import "server-only";
import type { ServerClient } from "@/lib/supabase/types";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import { UserError } from "@/lib/actions/user-error";

export interface CreateEvaluationInput {
  studentId: string;
  teacherId: string; // row's teacher_id (admin passes form value; teacher passes own id)
  evaluationType: "weekly" | "biweekly" | "monthly" | "quarterly";
  evaluationDate: string; // YYYY-MM-DD (already zod-validated by the adapter)
  scores: {
    hifz: number | null;
    tajweed: number | null;
    fluency: number | null;
    attendance: number | null;
    overall: number | null;
  };
  text: {
    strengths: string | null;
    areasForImprovement: string | null;
    nextGoals: string | null;
    teacherComments: string | null;
  };
  actor: { id: string; role: "admin" | "teacher" };
}

/**
 * Progress domain — evaluation write surface (ADR-0002 recipe).
 *
 * Owns the create-evaluation choreography: teacher IDOR guard,
 * session_evaluations insert, best-effort notify + evaluation.created emit.
 * The route adapter keeps zod parsing, auth preflight, loudAction, and
 * revalidatePath. Client is injected (RLS-enforced authed client) — the
 * insert runs under the caller's RLS, exactly as before extraction.
 */
export async function createEvaluationRecord(
  supabase: ServerClient,
  input: CreateEvaluationInput,
): Promise<void> {
  // Teacher IDOR guard: a teacher may only evaluate students they teach,
  // and only under their own identity — never attribute the row to a
  // different teacher_id (CodeRabbit finding on PR #771). Admin has
  // legitimate cross-student/cross-teacher standing and skips both checks.
  if (input.actor.role === "teacher") {
    if (input.teacherId !== input.actor.id) {
      throw new UserError("لا يمكنك إنشاء تقييم باسم معلم آخر");
    }
    const { data: relation, error: relationError } = await supabase
      .from("bookings")
      .select("id")
      .eq("teacher_id", input.actor.id)
      .eq("student_id", input.studentId)
      .limit(1)
      .maybeSingle();
    // A DB/RLS failure surfaces as { data: null, error }, indistinguishable
    // from "no relation" if left unchecked — that would misclassify an
    // infra failure as an authz denial (CodeRabbit finding on PR #771).
    if (relationError) {
      throw new Error("evaluation relation check failed: " + relationError.message);
    }
    if (!relation) throw new UserError("لا يمكنك تقييم طالب لم تُدرّسه");
  }

  const { error } = await supabase.from("session_evaluations").insert({
    student_id: input.studentId,
    teacher_id: input.teacherId,
    evaluation_type: input.evaluationType as TableInsert<"session_evaluations">["evaluation_type"],
    evaluation_date: input.evaluationDate,
    hifz_score: input.scores.hifz,
    tajweed_score: input.scores.tajweed,
    fluency_score: input.scores.fluency,
    attendance_score: input.scores.attendance,
    overall_score: input.scores.overall,
    strengths: input.text.strengths,
    areas_for_improvement: input.text.areasForImprovement,
    next_goals: input.text.nextGoals,
    teacher_comments: input.text.teacherComments,
  } satisfies TableInsert<"session_evaluations">);
  if (error) throw error;

  // Best-effort fan-out. notify() is never-throw (Task 1); .catch kept
  // for defense in depth, matching the booking orchestrators.
  const recipients =
    input.actor.role === "admin"
      ? [input.studentId, input.teacherId]
      : [input.studentId];
  const message =
    input.actor.role === "admin"
      ? { title: "تقييم جديد", body: "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات" }
      : { title: "تقييم جديد من معلمك", body: "أضاف معلمك تقييماً جديداً — يمكنك الاطلاع عليه من صفحة التقييمات" };
  for (const uid of recipients) {
    await notify({ userId: uid, type: "system", ...message }).catch((err) =>
      logError("createEvaluationRecord: notify failed", err, {
        tag: "progress-domain",
        metadata: { studentId: input.studentId, recipient: uid },
      }),
    );
  }

  await emitEvent("evaluation.created", "evaluation", input.studentId, {
    student_id: input.studentId,
    teacher_id: input.teacherId,
    evaluation_type: input.evaluationType,
  }).catch((err) =>
    logError("createEvaluationRecord: emit evaluation.created failed", err, {
      tag: "progress-domain",
      metadata: { studentId: input.studentId },
    }),
  );
}

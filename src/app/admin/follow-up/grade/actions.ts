"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { HOMEWORK_STATUS_AR } from "@/lib/constants";
import type { HomeworkAssignment, HomeworkStatus } from "@/types/database";

export type GradeKey = "excellent" | "good" | "needs_work" | "not_done";

export interface BulkGradeInput {
  id: string;
  grade: GradeKey;
  feedback?: string | null;
}

export interface BulkGradeResult {
  graded: number;
  failed: number;
  errors: string[];
}

// Map the UI's 4 grade keys → the corresponding HomeworkStatus enum values.
// (Mirrors the enum in src/types/database.ts: completed_excellent | completed_good | completed_needs_work | completed_not_done.)
const GRADE_TO_STATUS: Record<GradeKey, HomeworkStatus> = {
  excellent: "completed_excellent",
  good: "completed_good",
  needs_work: "completed_needs_work",
  not_done: "completed_not_done",
};

const VALID_GRADES: ReadonlySet<string> = new Set<GradeKey>([
  "excellent",
  "good",
  "needs_work",
  "not_done",
]);

export async function bulkGradeHomework(
  items: BulkGradeInput[],
): Promise<BulkGradeResult> {
  const result: BulkGradeResult = { graded: 0, failed: 0, errors: [] };

  if (!Array.isArray(items) || items.length === 0) {
    return result;
  }

  // ─── Auth: admin only ──────────────────────────────────────────────────────
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    result.failed = items.length;
    result.errors.push(e instanceof ForbiddenError ? "ليس لديك صلاحية" : "تعذر التحقق من الصلاحية");
    return result;
  }
  const user = { id: actorId };

  // ─── Bulk update via service-role client (follow-up RLS is teacher-scoped) ──
  const admin = createAdminClient();

  for (const item of items) {
    try {
      if (!item?.id || !item?.grade || !VALID_GRADES.has(item.grade)) {
        result.failed += 1;
        result.errors.push(`بيانات غير صحيحة للصف ${item?.id ?? "?"}`);
        continue;
      }

      const status = GRADE_TO_STATUS[item.grade];
      const feedback =
        typeof item.feedback === "string" && item.feedback.trim()
          ? item.feedback.trim()
          : null;

      // Fetch current follow-up (needed for notify + emit payload)
      const { data: hw, error: fetchErr } = await admin
        .from("homework_assignments")
        .select("id, title, student_id, teacher_id, status")
        .eq("id", item.id)
        .returns<
          Pick<
            HomeworkAssignment,
            "id" | "title" | "student_id" | "teacher_id" | "status"
          >[]
        >()
        .single();

      if (fetchErr || !hw) {
        result.failed += 1;
        result.errors.push(`المتابعة ${item.id} غير موجودة`);
        continue;
      }

      if (hw.status !== "student_ready") {
        result.failed += 1;
        result.errors.push(
          `المتابعة ${item.id} ليست في حالة "جاهز" (الحالة الحالية: ${hw.status})`,
        );
        continue;
      }

      const now = new Date().toISOString();

      // Update the follow-up row.
      // Schema has `completed_at` + `teacher_notes` (no graded_at/graded_by/grade_notes columns);
      // admin actor identity is captured via audit_log.changed_by below.
      const { error: updateErr } = await admin
        .from("homework_assignments")
        .update({
          status,
          completed_at: now,
          teacher_notes: feedback,
        } as never)
        .eq("id", item.id);

      if (updateErr) {
        result.failed += 1;
        result.errors.push(`تعذّر تحديث ${item.id}: ${updateErr.message}`);
        continue;
      }

      // Audit trail — one row per graded follow-up.
      try {
        await admin.from("audit_log").insert({
          changed_by: user.id,
          table_name: "homework_assignments",
          record_id: item.id,
          action: "UPDATE",
          old_data: { status: hw.status, completed_at: null },
          new_data: {
            status,
            completed_at: now,
            teacher_notes: feedback,
            graded_by: user.id,
          },
          reason: "admin bulk-grade",
        }).then((r) => {
          if (r.error) logError("bulkGradeFollowup: audit row failed", r.error, { tag: "admin-followup-grade" });
        });
      } catch (err) {
        logError("bulkGradeFollowup: audit insert threw", err, { tag: "admin-followup-grade" });
      }

      // Notify student (mirror gradeHomework's pattern).
      try {
        const gradeLabel = HOMEWORK_STATUS_AR[status];
        await notify({
          userId: hw.student_id,
          type: "homework",
          title: "تم تقييم متابعتك",
          body: `تم تقييم متابعة "${hw.title}" — النتيجة: ${gradeLabel}`,
          entityType: "homework",
          entityId: item.id,
        });
      } catch (err) {
        logError("bulkGradeFollowup: notify failed", err, { tag: "admin-followup-grade" });
      }

      // Emit homework.graded event to n8n.
      try {
        await emitEvent(
          "homework.graded",
          "homework",
          item.id,
          {
            student_id: hw.student_id,
            teacher_id: hw.teacher_id,
            grade: item.grade,
            graded_by_admin: user.id,
          },
          user.id,
        );
      } catch (err) {
        logError("bulkGradeFollowup: emitEvent failed", err, { tag: "admin-followup-grade" });
      }

      result.graded += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(
        err instanceof Error ? err.message : "فشل غير متوقع",
      );
      // Keep going — one bad row must not fail the whole batch.
    }
  }

  // Revalidate affected paths so the page reflects the latest queue.
  revalidatePath("/admin/follow-up/grade");
  revalidatePath("/teacher/follow-up");
  revalidatePath("/student/follow-up");

  return result;
}

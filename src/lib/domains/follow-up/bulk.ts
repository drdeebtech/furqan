import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import type { HomeworkStatus } from "@/types/database";
import { gradeFollowUp } from "./actions";
import {
  FollowUpUserError,
  FollowUpNotFoundError,
  type FollowUpActor,
  type BulkGradeItem,
  type BulkGradeResult,
  type GradeKey,
} from "./types";

/**
 * Follow-up domain — admin bulk-grade.
 *
 * Routes every grade through the SAME domain write (`gradeFollowUp`) so
 * there is no second grade/notify/emit/auto-regen implementation. The
 * loop owns only the bulk concerns: mapping the UI's 4 grade keys to
 * `HomeworkStatus`, accumulating the partial-success aggregate, and
 * writing the bulk-context audit row per graded row (admin actor identity
 * isn't captured by the follow-up columns, so it lives in `audit_log`).
 *
 * This is NOT wrapped in `loudAction` (the `BulkGradeResult` shape doesn't
 * fit the wrapper's `{ message?: string }` output), so genuine fetch /
 * update failures inside `gradeFollowUp` reach Sentry via that function's
 * own `logError`/`{ cause }` wrapping. The loop additionally logs the
 * bulk-context audit-insert failures here.
 *
 * Auth stays at the route adapter (ADR-0002): the adapter resolves the
 * admin actor and passes it in.
 *
 * Intentional convergence (was a latent divergence): the legacy hand-rolled
 * bulk path did NOT run the needs_work/not_done auto-regeneration or the
 * parent notification — only the single-grade path did. Routing bulk through
 * `gradeFollowUp` unifies that: a bulk "needs work" now re-assigns + pings the
 * parent exactly like a single grade. The emit payload also drops the
 * bulk-only `graded_by_admin` field (the admin actor is still captured in the
 * audit row below). See the PR description for the full reconciliation note.
 */

type AdminClient = SupabaseClient<Database>;

// Map the UI's 4 grade keys → HomeworkStatus enum values.
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

export async function bulkGradeFollowUp(
  admin: AdminClient,
  actor: FollowUpActor,
  items: BulkGradeItem[],
): Promise<BulkGradeResult> {
  const result: BulkGradeResult = { graded: 0, failed: 0, errors: [] };

  if (!Array.isArray(items) || items.length === 0) {
    return result;
  }

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

      // Single-source grade write: same domain function the single-action
      // teacher/admin routes use (ownership, state guard, update, student
      // notify, auto-regen, homework.graded emit all happen inside).
      await gradeFollowUp(admin, actor, {
        followUpId: item.id,
        grade: status,
        teacherNotes: feedback,
      });

      // Bulk-context audit row — captures the admin actor + "admin
      // bulk-grade" reason that the follow-up columns can't hold. Distinct
      // context, not a duplicated grade implementation. Best-effort.
      const auditPayload: TableInsert<"audit_log"> = {
        changed_by: actor.id,
        table_name: "homework_assignments",
        record_id: item.id,
        action: "UPDATE",
        old_data: { status: "student_ready", completed_at: null },
        new_data: {
          status,
          teacher_notes: feedback,
          graded_by: actor.id,
        },
        reason: "admin bulk-grade",
      };
      await admin
        .from("audit_log")
        .insert(auditPayload)
        .then((r) => {
          if (r.error) logError("bulkGradeFollowUp: audit row failed", r.error, { tag: "admin-followup-grade" });
        });

      result.graded += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(bulkErrorMessage(item, err));
      // Keep going — one bad row must not fail the whole batch. Genuine
      // infra failures inside gradeFollowUp already reached Sentry via its
      // own { cause } wrapping; the aggregate carries the user-facing copy.
    }
  }

  return result;
}

/**
 * Shape a per-row domain throw into the Arabic aggregate-error copy,
 * preserving the legacy messages ("غير موجودة" for not-found, the
 * not-ready / generic forms) so the admin screen reads the same.
 */
function bulkErrorMessage(item: BulkGradeItem, err: unknown): string {
  if (err instanceof FollowUpNotFoundError) {
    return `المتابعة ${item?.id ?? "?"} غير موجودة`;
  }
  if (err instanceof FollowUpUserError) {
    return err.message;
  }
  return err instanceof Error ? err.message : "فشل غير متوقع";
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export type OptOutResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Set honor-board opt-out preference for a student (T024, spec 023).
 *
 * Authorization:
 *   - Student may set their own opt-out (callerUid === studentId).
 *   - Guardian may set it for a linked child (validated via guardian_children).
 *   - Everyone else → 403.
 *
 * Writes only is_opted_out — all other columns are managed by the compute job.
 * If the student has no honor_board_entries rows yet, the update affects 0 rows
 * which is correct: their preference is enforced when the compute job runs.
 */
export async function setOptOut(
  studentId: string,
  optedOut: boolean,
  callerUid: string,
): Promise<OptOutResult> {
  // admin: guardian path is cross-user UPDATE of a child's honor_board_entries (issue #523)
  const admin = createAdminClient();

  if (callerUid !== studentId) {
    const { data: link, error: linkErr } = await admin
      .from("guardian_children")
      .select("guardian_id")
      .eq("guardian_id", callerUid)
      .eq("child_id", studentId)
      .maybeSingle<{ guardian_id: string }>();

    if (linkErr) {
      logError("setOptOut: guardian_children lookup failed", linkErr, {
        tag: "honor-board",
        caller_uid: callerUid,
        student_id: studentId,
      });
      return { ok: false, error: "could not verify guardian link", status: 500 };
    }

    if (!link) {
      return {
        ok: false,
        error: "not authorized to manage this student's opt-out preference",
        status: 403,
      };
    }
  }

  const { error } = await admin
    .from("honor_board_entries")
    .update({ is_opted_out: optedOut })
    .eq("student_id", studentId);

  if (error) {
    logError("setOptOut: update failed", error, {
      tag: "honor-board",
      student_id: studentId,
    });
    return { ok: false, error: error.message, status: 500 };
  }

  return { ok: true };
}

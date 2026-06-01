"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";

/**
 * Murajaah review completion (spec 001). The student marks one due review done
 * with a recall quality; complete_review() applies the SM-2 recompute and pushes
 * the item's next_review_at forward.
 *
 * complete_review is SECURITY INVOKER + RLS-gated (student can only update their
 * own schedule rows), so this runs on the user-context client — no admin client.
 */
const markReviewCompleteBase = loudAction<{ scheduleId: string; quality: number }, { message: string }>({
  name: "student.murajaah.complete-review",
  severity: "info",
  preflight: async () => {
    const { id } = await requireRole("student");
    return { actorId: id };
  },
  handler: async ({ scheduleId, quality }) => {
    const supabase = await createClient();
    // `as never`: complete_review isn't in the stale generated types (issue #185);
    // its signature lives in src/types/database.ts.
    const { error } = await supabase.rpc("complete_review" as never, {
      p_schedule_id: scheduleId,
      p_quality: quality,
    } as never);
    if (error) throw new Error("تعذر تسجيل المراجعة — حاول مرة أخرى");

    revalidatePath("/student/dashboard");
    return { message: "done" };
  },
});

/**
 * @param quality SM-2 recall quality 0–5. The card maps "تمت" → 4 (good recall)
 *        and "صعبة" → 2 (a lapse: shortens the next interval and lowers EF).
 */
export async function markReviewComplete(
  scheduleId: string,
  quality: number,
): Promise<{ success?: true; error?: string }> {
  const q = Number.isInteger(quality) ? Math.max(0, Math.min(5, quality)) : 4;
  const result = await markReviewCompleteBase({ scheduleId, quality: q });
  return result.ok ? { success: true } : { error: result.error };
}

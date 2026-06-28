"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";
import { reviewOutcome } from "@/lib/domains/murajaah/sm2";

/**
 * Murajaah review completion (spec 001). The student marks one due review done
 * with a recall quality; the SM-2 recompute (src/lib/domains/murajaah/sm2.ts —
 * the tested single source of truth) advances the item's spacing, and
 * complete_review() atomically persists the new {easiness, interval_days} and
 * stamps next_review_at off the DB clock.
 *
 * complete_review is SECURITY INVOKER + RLS-gated (student can only read/update
 * their own schedule rows), so this runs on the user-context client — no admin.
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

    // Read the item's current spacing state. RLS gates this to the student's own
    // row. student_review_schedule isn't in the generated types yet (issue #185),
    // so query via a loosely-typed client (mirrors getTodaysMurajaahBatch).
    const { data: row, error: readErr } = await (supabase as unknown as SupabaseClient)
      .from("student_review_schedule")
      .select("interval_days, easiness_factor")
      .eq("id", scheduleId)
      .maybeSingle<{ interval_days: number; easiness_factor: number }>();
    if (readErr) throw new Error("تعذر تسجيل المراجعة — حاول مرة أخرى");
    if (!row) throw new Error("تعذر العثور على هذه المراجعة");

    const next = reviewOutcome(
      { intervalDays: row.interval_days, easiness: row.easiness_factor },
      quality,
    );

    // `as never`: complete_review isn't in the stale generated types (issue #185);
    // its signature lives in src/types/database.ts.
    const { error } = await supabase.rpc("complete_review" as never, {
      p_schedule_id: scheduleId,
      p_easiness: next.easiness,
      p_interval_days: next.intervalDays,
    } as never);
    if (error) throw new Error("تعذر تسجيل المراجعة — حاول مرة أخرى");

    revalidatePath("/student/dashboard");
    return { message: "done" };
  },
});

/**
 * @param quality SM-2 recall quality 0–5. The card maps "حفظت" → 5 (good
 *        recall), "بجهد" → 3 (effortful but passing), and "لم أحفظ" → 1 (a
 *        lapse: resets the interval to 1 day and lowers EF). q ≥ 3 passes.
 */
export async function markReviewComplete(
  scheduleId: string,
  quality: number,
): Promise<{ success?: true; error?: string }> {
  const q = Number.isInteger(quality) ? Math.max(0, Math.min(5, quality)) : 4;
  const result = await markReviewCompleteBase({ scheduleId, quality: q });
  return result.ok ? { success: true } : { error: result.error };
}

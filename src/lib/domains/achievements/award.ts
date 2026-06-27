import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { BADGE_CATALOG, type AchievementType } from "./catalog";

/**
 * Award an achievement badge to a student (spec 033).
 *
 * The ONLY place that inserts into `public.achievements` and sends the
 * resulting notification / webhook event. Idempotency is handled by the DB
 * UNIQUE(student_id, type) constraint:
 *   - First call  → inserts, emits achievement.unlocked, sends bell notify.
 *   - Repeat call → Postgres raises 23505 unique_violation → returns
 *                   { awarded: false } with NO notify/emit — silent no-op.
 *   - Any other DB error → logged, returns { awarded: false }.
 *
 * Call this best-effort at domain seams:
 *   endSession()           → first_session
 *   announceJuzCompletion()→ first_juz
 *   studentDashboardView() → streak_7 / streak_30 (via after())
 *   recordProgress()       → level_up_intermediate / level_up_advanced
 *
 * NOTE: first_correction_clean is intentionally never passed here.
 * Its semantics are unresolved — see spec.md OPEN DECISIONS.
 */
export async function awardAchievement(
  studentId: string,
  type: AchievementType,
  metadata: Record<string, unknown> = {},
): Promise<{ awarded: boolean }> {
  const admin = createAdminClient();

  // New table not yet in generated types; cast mirrors the student_goals pattern.
  // admin: awardAchievement — service-role-only insert, no authed INSERT policy by design (spec 033)
  const { error } = await (admin as unknown as { from(t: string): {
    insert(data: Record<string, unknown>): Promise<{ error: { code?: string; message?: string } | null }>;
  } }).from("achievements").insert({
    student_id: studentId,
    type,
    metadata_json: metadata,
  });

  if (error) {
    // 23505 = unique_violation → already earned → idempotent no-op (no noise).
    if (error.code === "23505") return { awarded: false };
    logError("awardAchievement: insert failed", new Error(error.message ?? "unknown"), {
      tag: "achievements",
      studentId,
      type,
    });
    return { awarded: false };
  }

  const badge = BADGE_CATALOG[type];

  // Best-effort: emit then notify. Failures logged, never thrown.
  await emitEvent("achievement.unlocked", "achievement", studentId, { type, ...metadata }, studentId)
    .catch((err) =>
      logError("emit achievement.unlocked failed", err, { tag: "automation", type }),
    );

  await notify({
    userId: studentId,
    type: "system",
    title: badge.labelAr,
    body: badge.descriptionAr,
    entityType: "achievement",
    entityId: studentId,
  }).catch((err) =>
    logError("awardAchievement: notify failed", err, { tag: "achievements", type }),
  );

  return { awarded: true };
}

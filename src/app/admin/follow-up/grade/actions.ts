"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { bulkGradeFollowUp } from "@/lib/domains/follow-up/bulk";
import type {
  BulkGradeItem,
  BulkGradeResult,
} from "@/lib/domains/follow-up/types";

/**
 * Admin bulk-grade — route adapter (ADR-0002 shape).
 *
 * Owns the boundary: admin auth + `revalidatePath`. The grade logic
 * (per-row ownership/state guard, update, student notify, auto-regen,
 * `homework.graded` emit, audit) now lives once in the Follow-up domain
 * (`@/lib/domains/follow-up`) — this no longer re-implements the audit /
 * notify / emit fan-out it used to inline.
 *
 * NOT wrapped in `loudAction`: the `BulkGradeResult` aggregate doesn't fit
 * the wrapper's `{ message?: string }` output. Genuine infra failures
 * inside the domain reach Sentry via the domain's `{ cause }` wrapping.
 */

export type { GradeKey, BulkGradeResult } from "@/lib/domains/follow-up/types";

/** Back-compat alias for the legacy exported input name. */
export type BulkGradeInput = BulkGradeItem;

export async function bulkGradeHomework(
  items: BulkGradeInput[],
): Promise<BulkGradeResult> {
  // ─── Auth: admin only ──────────────────────────────────────────────────────
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    const failed = Array.isArray(items) ? items.length : 0;
    return {
      graded: 0,
      failed,
      errors: [e instanceof ForbiddenError ? "ليس لديك صلاحية" : "تعذر التحقق من الصلاحية"],
    };
  }

  // Bulk update via service-role client (follow-up RLS is teacher-scoped).
  const admin = createAdminClient();
  const result = await bulkGradeFollowUp(admin, { id: actorId, isAdmin: true }, items);

  // Revalidate affected paths so the page reflects the latest queue.
  revalidatePath("/admin/follow-up/grade");
  revalidatePath("/teacher/follow-up");
  revalidatePath("/student/follow-up");

  return result;
}

import "server-only";

import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { HomeworkStatus } from "@/types/database";
import { assertCanManage, type AdminClient } from "./shared";
import {
  FollowUpUserError,
  FollowUpNotFoundError,
  type FollowUpActor,
  type EditFollowUpInput,
  type EditFollowUpResult,
  type DeleteFollowUpInput,
  type DeleteFollowUpResult,
} from "./types";
import { validateRange, violationMessageAr } from "@/lib/domains/progress/validation";
import { surahName } from "@/lib/quran/surahs";

/**
 * Follow-up domain — manage writes (edit + delete).
 *
 * Split from `actions.ts` (the lifecycle writes: create / mark-ready /
 * grade) to keep each file under the 500-line ceiling. Same ADR-0002
 * contract: authenticated structured input, throws on failure, auth at the
 * route adapter.
 */

// ─── Edit Follow-up ──────────────────────────────────────────────────────────

const GRADED_STATUSES: HomeworkStatus[] = [
  "completed_excellent",
  "completed_good",
  "completed_needs_work",
  "completed_not_done",
];

/**
 * Edits an un-graded follow-up within the edit window (before the next
 * confirmed session starts). Verifies ownership (admin bypass), refuses
 * graded rows, and enforces the edit window.
 */
export async function editFollowUp(
  admin: AdminClient,
  actor: FollowUpActor,
  input: EditFollowUpInput,
): Promise<EditFollowUpResult> {
  const { followUpId, updates } = input;

  const { data: hw, error: hwErr } = await admin
    .from("homework_assignments")
    .select("teacher_id, student_id, assigned_at, status, surah_number, ayah_start, ayah_end")
    .eq("id", followUpId)
    .returns<{
      teacher_id: string; student_id: string; assigned_at: string;
      status: HomeworkStatus; surah_number: number | null; ayah_start: number | null; ayah_end: number | null;
    }[]>()
    .single();

  if (hwErr || !hw) {
    throw new FollowUpNotFoundError("المتابعة غير موجودة", { cause: hwErr ?? undefined });
  }
  assertCanManage(actor, hw.teacher_id, "غير مصرح");

  if ("surah_number" in updates || "ayah_start" in updates || "ayah_end" in updates) {
    const sn = ("surah_number" in updates ? updates.surah_number : hw.surah_number) as number | null;
    const as = ("ayah_start" in updates ? updates.ayah_start : hw.ayah_start) as number | null;
    const ae = ("ayah_end" in updates ? updates.ayah_end : hw.ayah_end) as number | null;
    for (const v of [sn, as, ae] as unknown[]) {
      if (v != null && (typeof v !== "number" || !Number.isFinite(v))) {
        throw new FollowUpUserError("قيم السورة والآيات يجب أن تكون أرقاماً");
      }
    }
    if (sn != null && (as == null || ae == null)) {
      throw new FollowUpUserError(
        "يجب تحديد آية البداية والنهاية مع السورة — لا يمكن ترك إحداهما فارغة.",
      );
    }
    if (sn != null && as != null && ae != null) {
      const violation = validateRange({ surahFrom: sn, ayahFrom: as, surahTo: sn, ayahTo: ae });
      if (violation) {
        throw new FollowUpUserError(violationMessageAr(violation, (n) => surahName(n, "ar")));
      }
    }
  }

  // Graded follow-ups are immutable. Editing post-grade would silently
  // change what the student was graded against. To re-grade, use the
  // explicit grade flow (fires student notifications + parent reports).
  if (GRADED_STATUSES.includes(hw.status)) {
    throw new FollowUpUserError("لا يمكن تعديل متابعة تم تقييمها. للتغيير، أنشئ متابعة جديدة.");
  }

  // Edit window: find the next confirmed session between same
  // teacher+student. PGRST116 (no row) is the common case.
  const { data: nextBooking, error: bookingErr } = await admin
    .from("bookings")
    .select("id")
    .eq("teacher_id", hw.teacher_id)
    .eq("student_id", hw.student_id)
    .eq("status", "confirmed")
    .gt("scheduled_at", hw.assigned_at)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .single<{ id: string }>();

  if (bookingErr && bookingErr.code !== "PGRST116") {
    throw new FollowUpUserError("فشل تعديل المتابعة", { cause: bookingErr });
  }

  if (nextBooking) {
    const { data: nextSession, error: sessionErr } = await admin
      .from("sessions")
      .select("started_at")
      .eq("booking_id", nextBooking.id)
      .single<{ started_at: string | null }>();

    if (sessionErr && sessionErr.code !== "PGRST116") {
      throw new FollowUpUserError("فشل تعديل المتابعة", { cause: sessionErr });
    }

    if (nextSession?.started_at) {
      throw new FollowUpUserError("انتهت فترة التعديل — بدأت الجلسة التالية");
    }
  }

  const EDITABLE_FIELDS = [
    "title",
    "description",
    "homework_type",
    "surah_number",
    "ayah_start",
    "ayah_end",
    "pages_count",
    "due_date",
    "teacher_notes",
  ] as const;

  const finalUpdates: TableUpdate<"homework_assignments"> = {
    ...Object.fromEntries(
      EDITABLE_FIELDS.flatMap((key) =>
        key in updates ? [[key, updates[key as keyof typeof updates]]] : []
      ),
    ),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("homework_assignments")
    .update(finalUpdates)
    .eq("id", followUpId);

  if (error) throw new FollowUpUserError("فشل تعديل المتابعة", { cause: error });

  return { followUpId };
}

// ─── Delete Follow-up ────────────────────────────────────────────────────────

/**
 * Deletes a follow-up and cascades to its auto-regenerated children,
 * writing a diff audit row that records the cascade size. Verifies
 * ownership (admin bypass). The cascade-count read is blocking — a real
 * infra error there blocks the delete rather than risk an unbounded
 * cascade with no audit. The audit row itself is best-effort.
 */
export async function deleteFollowUp(
  admin: AdminClient,
  actor: FollowUpActor,
  input: DeleteFollowUpInput,
): Promise<DeleteFollowUpResult> {
  const { followUpId } = input;

  const { data: hw, error: hwErr } = await admin
    .from("homework_assignments")
    .select("teacher_id")
    .eq("id", followUpId)
    .returns<{ teacher_id: string }[]>()
    .single();

  if (hwErr || !hw) {
    throw new FollowUpNotFoundError("المتابعة غير موجودة", { cause: hwErr ?? undefined });
  }
  assertCanManage(actor, hw.teacher_id, "ليس لديك صلاحية");

  // Count + delete children (auto-regenerated assignments) first so the
  // audit trail records how many we cascaded.
  const { data: children, error: childrenErr } = await admin
    .from("homework_assignments")
    .select("id, status, title")
    .eq("parent_assignment_id", followUpId)
    .returns<{ id: string; status: string; title: string }[]>();
  if (childrenErr) {
    // Block the delete rather than risk an unbounded cascade with no audit.
    throw new FollowUpUserError("فشل حذف المتابعة", { cause: childrenErr });
  }
  const childCount = children?.length ?? 0;

  if (childCount > 0) {
    await admin
      .from("homework_assignments")
      .delete()
      .eq("parent_assignment_id", followUpId);
  }

  const { error } = await admin
    .from("homework_assignments")
    .delete()
    .eq("id", followUpId);

  if (error) throw new FollowUpUserError("فشل حذف المتابعة", { cause: error });

  // Diff audit row carries cascade size. Best-effort: an audit_log insert
  // failure must never block the delete itself succeeding.
  await admin
    .from("audit_log")
    .insert({
      changed_by: actor.id,
      action: "DELETE",
      table_name: "homework_assignments",
      record_id: followUpId,
      new_data: { cascaded_children: childCount, child_ids: children?.map((c) => c.id) ?? [] },
    } satisfies TableInsert<"audit_log">)
    .then((r) => {
      if (r.error)
        logError("audit_log insert failed for follow-up delete", r.error, {
          tag: "audit",
          followUpId,
          childCount,
        });
    });

  return { followUpId, cascadedChildren: childCount };
}

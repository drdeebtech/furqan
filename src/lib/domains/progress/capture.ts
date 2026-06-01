import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { surahName } from "@/lib/quran/surahs";
import { validateRange, violationMessageAr } from "./validation";
import type { RecordProgressInput, RecordProgressOutcome } from "./types";

/**
 * Progress domain — ḥifẓ capture (spec 010).
 *
 * The single seam that writes a validated `student_progress` row. Validates the
 * range at the action layer (Arabic message, FR-004) before the RPC, then calls
 * the atomic `record_student_progress()` function (FR-005) which re-validates in
 * the DB trigger (FR-002, the hard guard for every writer).
 *
 * Auth is the route adapter's job (Principle IV); this takes authenticated
 * structured input.
 */

type AdminClient = SupabaseClient<Database>;

export async function recordProgress(
  admin: AdminClient,
  input: RecordProgressInput,
): Promise<RecordProgressOutcome> {
  // `new` (a memorized portion) MUST carry a range; review/correction may omit it.
  if (input.progressType === "new" && input.range === null) {
    return {
      ok: false,
      reason: "missing_range",
      message: "يجب تحديد نطاق الحفظ الجديد (من سورة:آية إلى سورة:آية).",
    };
  }

  // Action-layer validation (UX layer of defense in depth).
  if (input.range) {
    const violation = validateRange(input.range);
    if (violation) {
      return {
        ok: false,
        reason: "invalid_range",
        message: violationMessageAr(violation, (n) => surahName(n, "ar")),
      };
    }
  }

  const { data, error } = await admin.rpc("record_student_progress" as never, {
    p_booking_id: input.bookingId,
    p_progress_type: input.progressType,
    p_surah_from: input.range?.surahFrom ?? null,
    p_ayah_from: input.range?.ayahFrom ?? null,
    p_surah_to: input.range?.surahTo ?? null,
    p_ayah_to: input.range?.ayahTo ?? null,
    p_pages_reviewed: input.pagesReviewed ?? null,
    p_quality_rating: input.qualityRating ?? null,
    p_level: input.level ?? null,
    p_teacher_notes: input.teacherNotes ?? null,
    p_errors: input.errors ? errorsToJson(input.errors) : null,
  } as never);

  if (error) {
    const msg = error.message ?? "";
    // The DB trigger (FR-002) is the backstop — map its raise to invalid_range.
    if (msg.includes("exceeds surah") || msg.includes("invalid surah")) {
      return { ok: false, reason: "invalid_range", message: "نطاق الآيات غير صالح لهذه السورة." };
    }
    if (msg.includes("booking_not_found")) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "error", message: msg };
  }

  // record_student_progress returns the new progress row id (text). Guard the
  // runtime shape — a null/unexpected return WITHOUT an error must not become a
  // false success carrying an invalid id. (`as never` on the rpc call mirrors
  // the confirm_booking_with_session pattern: the custom fn isn't in the stale
  // generated types, issue #185; its signature lives in src/types/database.ts.)
  const progressId: unknown = data;
  if (typeof progressId !== "string" || progressId.length === 0) {
    return { ok: false, reason: "error", message: "record_student_progress returned no id" };
  }
  return { ok: true, progressId };
}

function errorsToJson(errors: RecordProgressInput["errors"]) {
  return (errors ?? []).map((e) => ({
    surah_num: e.surahNum,
    ayah_num: e.ayahNum,
    error_type: e.errorType,
    note: e.note ?? null,
  }));
}

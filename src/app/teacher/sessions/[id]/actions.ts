"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import { recordProgress } from "@/lib/domains/progress/capture";
import type { ProgressType, StudentLevel } from "@/lib/domains/progress/types";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

async function loggedInPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  return { actorId: user.id };
}

// ─── savePostSessionNotes ───────────────────────────────────────────────────

type SavePostSessionNotesInput = {
  sessionId: string;
  notes: string;
  homework: string;
};

const savePostSessionNotesBase = loudAction<SavePostSessionNotesInput, { message: string }>({
  name: "teacher.session.save-post-session-notes",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher save post-session notes",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, notes, homework }) => {
    const supabase = await createClient();
    // `.select()` makes the update return the rows it touched. RLS-denied
    // updates come back as `error: null` + `data: []`, which would
    // otherwise be reported as a successful save while nothing changed.
    // Defense-in-depth flagged by CodeRabbit on PR #271.
    const { data, error } = await supabase
      .from("sessions")
      .update({
        post_session_notes: notes || null,
        homework: homework || null,
      } as never)
      .eq("id", sessionId)
      .select("id");
    if (error) {
      throw new UserError("حدث خطأ أثناء حفظ الملاحظات — يرجى المحاولة مرة أخرى", { cause: error });
    }
    if (!data || data.length === 0) {
      throw new UserError("الجلسة غير موجودة أو ليس لديك صلاحية عليها");
    }

    revalidatePath(`/teacher/sessions/${sessionId}`);
    await emitEvent("session.notes_saved", "session", sessionId, {
      has_notes: !!notes,
      has_homework: !!homework,
    }).catch((err) =>
      logError("emit session.notes_saved failed", err, { tag: "automation", event: "session.notes_saved" }),
    );
    return { message: "saved" };
  },
});

export async function savePostSessionNotes(
  sessionId: string,
  notes: string,
  homework: string,
): Promise<{ success?: true; error?: string }> {
  const result = await savePostSessionNotesBase({ sessionId, notes, homework });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// Sprint 2.2 (2026-05-05) — "no errors observed" mechanism. Sentinel approach:
// instead of adding a sessions.no_errors_observed column (which would need a
// migration + types regen), we insert a marker row into recitation_errors
// keyed by note='__no_errors_observed_sentinel__'. This makes the existing
// banner flip green (count > 0) and is invisible to users; analytics that
// count "real" errors should filter out this note value.
const NO_ERRORS_SENTINEL = "__no_errors_observed_sentinel__";

// ─── markNoErrorsObserved ───────────────────────────────────────────────────

type MarkNoErrorsObservedInput = { sessionId: string; bookingId: string };
type MarkNoErrorsObservedResult = { success: true; alreadyMarked?: true } | { error: string };

const markNoErrorsObservedBase = loudAction<
  MarkNoErrorsObservedInput,
  { message: string }
>({
  name: "teacher.session.mark-no-errors",
  severity: "info",
  audit: {
    table: "recitation_errors",
    recordId: (i) => i.sessionId,
    action: "INSERT",
    reasonPrefix: "teacher mark no errors observed",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, bookingId }, { actorId }) => {
    const supabase = await createClient();

    // Verify the booking belongs to this teacher and grab the student id.
    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .select("student_id, teacher_id")
      .eq("id", bookingId)
      .single<{ student_id: string; teacher_id: string }>();
    if (bookErr || !booking) throw notFoundOrInfra(bookErr, "تعذر العثور على الحجز");
    if (booking.teacher_id !== actorId) throw new UserError("ليس لديك صلاحية على هذه الجلسة");

    // Find or create the student_progress row for this booking. The unique
    // constraint on (student_id, booking_id) means upsert with onConflict
    // returns the existing row id without inserting a duplicate.
    const { data: progress, error: progErr } = await supabase
      .from("student_progress")
      .upsert({
        student_id: booking.student_id,
        teacher_id: booking.teacher_id,
        booking_id: bookingId,
        progress_type: "muraja",
        teacher_notes: "no errors observed (sentinel)",
      } as never, { onConflict: "student_id,booking_id" })
      .select("id")
      .single<{ id: string }>();
    if (progErr || !progress) {
      throw new UserError("تعذر تسجيل الحالة — يرجى المحاولة مرة أخرى", { cause: progErr ?? new Error("progress upsert returned no row") });
    }

    // Skip insert if a sentinel already exists for this progress row.
    const { count: existing, error: countErr } = await supabase
      .from("recitation_errors")
      .select("id", { count: "exact", head: true })
      .eq("progress_id", progress.id)
      .eq("note", NO_ERRORS_SENTINEL);
    if (countErr) throw new UserError("تعذر تسجيل الحالة — يرجى المحاولة مرة أخرى", { cause: countErr });
    if ((existing ?? 0) > 0) {
      revalidatePath(`/teacher/sessions/${sessionId}`);
      return { message: "already-marked" };
    }

    const { error: insErr } = await supabase
      .from("recitation_errors")
      .insert({
        progress_id: progress.id,
        ayah_num: 0,
        error_type: "other",
        note: NO_ERRORS_SENTINEL,
        resolved: true,
        resolved_at: new Date().toISOString(),
      } as never);
    if (insErr) throw new UserError("تعذر تسجيل الحالة — يرجى المحاولة مرة أخرى", { cause: insErr });

    revalidatePath(`/teacher/sessions/${sessionId}`);
    return { message: "marked" };
  },
});

export async function markNoErrorsObserved(
  sessionId: string,
  bookingId: string,
): Promise<MarkNoErrorsObservedResult> {
  const result = await markNoErrorsObservedBase({ sessionId, bookingId });
  if (!result.ok) return { error: result.error };
  // The handler returns "already-marked" via message; preserve the existing
  // alreadyMarked flag in the public shape so callers don't break.
  if (result.message === "already-marked") {
    return { success: true, alreadyMarked: true };
  }
  return { success: true };
}

// ─── recordSessionProgress (spec 010 — ḥifẓ capture) ────────────────────────

export interface RecordSessionProgressInput {
  sessionId: string;
  bookingId: string;
  progressType: ProgressType;
  // null range allowed for muraja/correction; required for `new` (domain enforces)
  surahFrom: number | null;
  ayahFrom: number | null;
  surahTo: number | null;
  ayahTo: number | null;
  pagesReviewed?: number | null;
  qualityRating?: number | null;
  level?: StudentLevel;
  teacherNotes?: string | null;
}

const recordSessionProgressBase = loudAction<RecordSessionProgressInput, { message: string }>({
  name: "teacher.session.record-progress",
  // Academic record write — info severity (not a live-session disruption like
  // endSession). Audit envelope captures who recorded what.
  severity: "info",
  audit: {
    table: "student_progress",
    recordId: (i) => i.bookingId,
    action: "UPDATE",
    reasonPrefix: "teacher record hifz progress",
  },
  preflight: loggedInPreflight,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();

    // Principle IV — authorize at the boundary: the teacher must own this booking.
    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .select("teacher_id")
      .eq("id", input.bookingId)
      .single<{ teacher_id: string }>();
    if (bookErr || !booking) throw notFoundOrInfra(bookErr, "تعذر العثور على الحجز");
    if (booking.teacher_id !== actorId) throw new UserError("ليس لديك صلاحية على هذه الجلسة");

    const range =
      input.surahFrom != null && input.ayahFrom != null && input.surahTo != null && input.ayahTo != null
        ? { surahFrom: input.surahFrom, ayahFrom: input.ayahFrom, surahTo: input.surahTo, ayahTo: input.ayahTo }
        : null;

    const admin = createAdminClient();
    const outcome = await recordProgress(admin, {
      bookingId: input.bookingId,
      progressType: input.progressType,
      range,
      pagesReviewed: input.pagesReviewed ?? null,
      qualityRating: input.qualityRating ?? null,
      level: input.level,
      teacherNotes: input.teacherNotes ?? null,
    });

    if (!outcome.ok) {
      // invalid_range / missing_range carry an Arabic message; not_found/error too.
      throw new UserError(
        "message" in outcome ? outcome.message : "تعذر تسجيل الحفظ — يرجى المحاولة مرة أخرى",
      );
    }

    revalidatePath(`/teacher/sessions/${input.sessionId}`);
    revalidatePath("/teacher/dashboard");
    await emitEvent("progress.recorded", "student_progress", outcome.progressId, {
      booking_id: input.bookingId,
      teacher_id: actorId,
      progress_type: input.progressType,
      // Emit the normalized range that was actually persisted (null for a
      // partial/absent range), not the raw input fragments — otherwise
      // automation consumers can see a half-range that was never stored.
      surah_from: range?.surahFrom ?? null,
      surah_to: range?.surahTo ?? null,
    }).catch((err) =>
      logError("emit progress.recorded failed", err, { tag: "automation", event: "progress.recorded" }),
    );

    return { message: "recorded" };
  },
});

export async function recordSessionProgress(
  input: RecordSessionProgressInput,
): Promise<{ success?: true; error?: string }> {
  const result = await recordSessionProgressBase(input);
  if (!result.ok) return { error: result.error };
  return { success: true };
}

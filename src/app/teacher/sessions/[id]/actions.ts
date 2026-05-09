"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";

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
    const { error } = await supabase
      .from("sessions")
      .update({
        post_session_notes: notes || null,
        homework: homework || null,
      } as never)
      .eq("id", sessionId);
    if (error) {
      throw new UserError("حدث خطأ أثناء حفظ الملاحظات — يرجى المحاولة مرة أخرى", { cause: error });
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

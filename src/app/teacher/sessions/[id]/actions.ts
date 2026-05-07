"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

export async function savePostSessionNotes(
  sessionId: string,
  notes: string,
  homework: string,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("sessions")
    .update({
      post_session_notes: notes || null,
      homework: homework || null,
    })
    .eq("id", sessionId);

  if (error) {
    return { error: "حدث خطأ أثناء حفظ الملاحظات — يرجى المحاولة مرة أخرى" };
  }

  revalidatePath(`/teacher/sessions/${sessionId}`);
  await emitEvent("session.notes_saved", "session", sessionId, { has_notes: !!notes, has_homework: !!homework })
    .catch((err) => logError("emit session.notes_saved failed", err, { tag: "automation", event: "session.notes_saved" }));
  return { success: true };
}

// Sprint 2.2 (2026-05-05) — "no errors observed" mechanism. Sentinel approach:
// instead of adding a sessions.no_errors_observed column (which would need a
// migration + types regen), we insert a marker row into recitation_errors
// keyed by note='__no_errors_observed_sentinel__'. This makes the existing
// banner flip green (count > 0) and is invisible to users; analytics that
// count "real" errors should filter out this note value.
//
// To upgrade later: a migration that adds sessions.no_errors_observed +
// backfills it from `EXISTS (recitation_errors WHERE note = sentinel)` and
// drops the sentinel rows.
const NO_ERRORS_SENTINEL = "__no_errors_observed_sentinel__";

export async function markNoErrorsObserved(sessionId: string, bookingId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Verify the booking belongs to this teacher and grab the student id.
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", bookingId)
    .single<{ student_id: string; teacher_id: string }>();
  if (bookErr || !booking) {
    return { error: "تعذر العثور على الحجز" };
  }
  if (booking.teacher_id !== user.id) {
    return { error: "ليس لديك صلاحية على هذه الجلسة" };
  }

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
    logError("teacher markNoErrorsObserved progress upsert failed", progErr, {
      tag: "teacher-session",
      severity: "warning",
      metadata: { sessionId, bookingId, teacherId: user.id },
    });
    return { error: "تعذر تسجيل الحالة — يرجى المحاولة مرة أخرى" };
  }

  // Skip insert if a sentinel already exists for this progress row.
  const { count: existing } = await supabase
    .from("recitation_errors")
    .select("id", { count: "exact", head: true })
    .eq("progress_id", progress.id)
    .eq("note", NO_ERRORS_SENTINEL);
  if ((existing ?? 0) > 0) {
    revalidatePath(`/teacher/sessions/${sessionId}`);
    return { success: true, alreadyMarked: true };
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
  if (insErr) {
    logError("teacher markNoErrorsObserved sentinel insert failed", insErr, {
      tag: "teacher-session",
      severity: "warning",
      metadata: { sessionId, bookingId, progressId: progress.id },
    });
    return { error: "تعذر تسجيل الحالة — يرجى المحاولة مرة أخرى" };
  }

  revalidatePath(`/teacher/sessions/${sessionId}`);
  return { success: true };
}

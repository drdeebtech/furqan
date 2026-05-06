"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export interface EnrollState {
  ok?: boolean;
  error?: string;
}

interface SessionRow {
  id: string;
  session_mode: string;
  scheduled_at: string | null;
  capacity: number;
  current_enrollment: number;
}

/**
 * Stage 5 student halaqa enrollment.
 *
 * Race-safe via two guards:
 *  1. session_participants UNIQUE(session_id, user_id) catches duplicate
 *     enrollment attempts.
 *  2. The enrollment-counter UPDATE has `current_enrollment < capacity`
 *     in its WHERE clause; if two students enroll simultaneously when
 *     only one seat remains, only one UPDATE succeeds (RETURNING empty
 *     for the loser).
 *
 * If the counter UPDATE loses the race, the participant row is rolled
 * back so the loser sees "halaqa is full" instead of being stuck in a
 * half-enrolled state.
 */
export async function enrollInHalaqa(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const admin = createAdminClient();

  // Snapshot read — advisory only. The race-safe guard is in the UPDATE
  // below.
  const { data: session, error: sessErr } = await admin
    .from("sessions")
    .select("id, session_mode, scheduled_at, capacity, current_enrollment")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (sessErr || !session) {
    logError("enrollInHalaqa: session lookup failed", sessErr, {
      tag: "halaqa.enroll",
      metadata: { session_id: sessionId },
    });
    return { error: "الحلقة غير موجودة" };
  }
  if (session.session_mode !== "halaqa") return { error: "هذه ليست حلقة" };
  if (session.scheduled_at && new Date(session.scheduled_at).getTime() < Date.now()) {
    return { error: "الحلقة بدأت بالفعل" };
  }
  if (session.current_enrollment >= session.capacity) {
    return { error: "الحلقة ممتلئة" };
  }

  // Insert participant. UNIQUE(session_id, user_id) catches duplicates.
  const { error: insErr } = await admin
    .from("session_participants")
    .insert({
      session_id: sessionId,
      user_id: user.id,
      role: "student",
      attendance_status: "registered",
    } as never);
  if (insErr) {
    if (insErr.code === "23505") return { error: "أنت مسجل في هذه الحلقة بالفعل" };
    logError("enrollInHalaqa: participant insert failed", insErr, {
      tag: "halaqa.enroll",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: `فشل التسجيل: ${insErr.message}` };
  }

  // Race-safe capacity check via WHERE clause. RETURNING empty = lost
  // the race against another student. Roll back the participant row.
  const { data: updated, error: updErr } = await admin
    .from("sessions")
    .update({
      current_enrollment: session.current_enrollment + 1,
    } as never)
    .eq("id", sessionId)
    .lt("current_enrollment", session.capacity)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updErr || !updated) {
    // Race lost OR update error — roll back the participant insert.
    await admin
      .from("session_participants")
      .delete()
      .eq("session_id", sessionId)
      .eq("user_id", user.id);

    if (updErr) {
      logError("enrollInHalaqa: enrollment counter update failed", updErr, {
        tag: "halaqa.enroll",
        metadata: { session_id: sessionId },
      });
      return { error: `فشل تحديث العداد: ${updErr.message}` };
    }
    return { error: "الحلقة ممتلئة" };
  }

  revalidatePath("/student/halaqas");
  revalidatePath(`/student/halaqas/${sessionId}`);
  return { ok: true };
}

/**
 * Cancel halaqa enrollment. Removes the student's session_participants
 * row and decrements current_enrollment.
 *
 * Not a hot race-condition path (a single student can't cancel twice),
 * so the snapshot-read + write is acceptable. If counter drift happens
 * via concurrent admin mutations, that's a separate operational concern
 * and a future migration can add a SQL function to do this atomically.
 */
export async function cancelHalaqaEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const admin = createAdminClient();

  // Delete the participant row. RETURNING tells us whether the row
  // existed before the delete.
  const { data: deletedRows, error: delErr } = await admin
    .from("session_participants")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .eq("role", "student")
    .select("id");

  if (delErr) {
    logError("cancelHalaqaEnrollment: delete failed", delErr, {
      tag: "halaqa.cancel",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: `فشل الإلغاء: ${delErr.message}` };
  }

  if (!deletedRows || deletedRows.length === 0) {
    return { error: "لست مسجلاً في هذه الحلقة" };
  }

  // Snapshot read + decrement. Clamp at 0 in case the counter is
  // already 0 due to a prior manual fix.
  const { data: session } = await admin
    .from("sessions")
    .select("current_enrollment")
    .eq("id", sessionId)
    .maybeSingle<{ current_enrollment: number }>();

  const next = Math.max(0, (session?.current_enrollment ?? 0) - 1);

  const { error: updErr } = await admin
    .from("sessions")
    .update({ current_enrollment: next } as never)
    .eq("id", sessionId);

  if (updErr) {
    // Soft-fail: counter mismatch is operationally fixable; we already
    // removed the participant, which is the user-visible action.
    logError("cancelHalaqaEnrollment: counter decrement failed", updErr, {
      tag: "halaqa.cancel",
      metadata: { session_id: sessionId },
    });
  }

  revalidatePath("/student/halaqas");
  revalidatePath(`/student/halaqas/${sessionId}`);
  return { ok: true };
}

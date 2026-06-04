"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

export interface EnrollState {
  ok?: boolean;
  error?: string;
}

export interface WaitlistState {
  ok?: boolean;
  error?: string;
  /** Position in line (1-indexed). Set when ok===true. */
  position?: number;
}

interface SessionRow {
  id: string;
  session_mode: string;
  scheduled_at: string | null;
  ended_at: string | null;
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
    .select("id, session_mode, scheduled_at, ended_at, capacity, current_enrollment")
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
  // Eligibility: reject ended sessions and sessions that have already started.
  if (session.ended_at) return { error: "الحلقة منتهية" };
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
    } as TableInsert<"session_participants">);
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
    })
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

  emitEvent("halaqa.enrolled", "session", sessionId, {
    student_id: user.id,
    session_id: sessionId,
  }, user.id).catch((err) =>
    logError("emit halaqa.enrolled failed", err, { tag: "halaqa.enroll" }),
  );

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

  // Read snapshot, then UPDATE only if counter still matches (optimistic
  // lock) and is > 0. Prevents underflow on concurrent admin mutations.
  const { data: session } = await admin
    .from("sessions")
    .select("current_enrollment")
    .eq("id", sessionId)
    .maybeSingle<{ current_enrollment: number }>();

  const snapshot = session?.current_enrollment ?? 0;
  const { data: updatedDecrement, error: updErr } = await admin
    .from("sessions")
    .update({ current_enrollment: Math.max(0, snapshot - 1) })
    .eq("id", sessionId)
    .eq("current_enrollment", snapshot)
    .gt("current_enrollment", 0)
    .select("id")
    .maybeSingle();

  if (updErr || !updatedDecrement) {
    // Soft-fail: counter mismatch is operationally fixable; we already
    // removed the participant, which is the user-visible action.
    logError(
      "cancelHalaqaEnrollment: counter decrement failed or optimistic lock lost",
      updErr ?? new Error("optimistic lock failed"),
      {
        tag: "halaqa.cancel",
        metadata: { session_id: sessionId, snapshot },
      },
    );
  }

  emitEvent("halaqa.enrollment_cancelled", "session", sessionId, {
    student_id: user.id,
    session_id: sessionId,
  }, user.id).catch((err) =>
    logError("emit halaqa.enrollment_cancelled failed", err, { tag: "halaqa.cancel" }),
  );

  revalidatePath("/student/halaqas");
  revalidatePath(`/student/halaqas/${sessionId}`);
  return { ok: true };
}

/**
 * Join the halaqa waiting list. Used when capacity is full.
 *
 * Position is computed from current max + 1 via snapshot read.
 * Race tolerance: two simultaneous joiners may collide on the same
 * position number — acceptable for v1 because the eventual
 * cancellation flow re-ranks. UNIQUE(session_id, student_id)
 * prevents the same student from joining twice.
 */
export async function joinHalaqaWaitingList(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const admin = createAdminClient();

  // Reject if already enrolled — joining the waiting list would be
  // a no-op and confusing in the UI.
  const { data: existingParticipant } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .eq("role", "student")
    .maybeSingle();
  if (existingParticipant) return { error: "أنت مسجل بالفعل" };

  // Snapshot-read the current max position for this session.
  const { data: lastRow } = await admin
    .from("halaqa_waiting_list")
    .select("position")
    .eq("session_id", sessionId)
    .is("promoted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  const nextPosition = (lastRow?.position ?? 0) + 1;

  const { error: insErr } = await admin
    .from("halaqa_waiting_list")
    .insert({
      session_id: sessionId,
      student_id: user.id,
      position: nextPosition,
    } as TableInsert<"halaqa_waiting_list">);

  if (insErr) {
    if (insErr.code === "23505") return { error: "أنت في قائمة الانتظار بالفعل" };
    logError("joinHalaqaWaitingList: insert failed", insErr, {
      tag: "halaqa.waitlist",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: `فشل الانضمام إلى قائمة الانتظار: ${insErr.message}` };
  }

  emitEvent("halaqa.waitlist_joined", "session", sessionId, {
    student_id: user.id,
    session_id: sessionId,
    position: nextPosition,
  }, user.id).catch((err) =>
    logError("emit halaqa.waitlist_joined failed", err, { tag: "halaqa.waitlist" }),
  );

  revalidatePath("/student/halaqas");
  revalidatePath(`/student/halaqas/${sessionId}`);
  return { ok: true, position: nextPosition };
}

/**
 * Leave the halaqa waiting list. Position re-ranking is deferred —
 * gaps in the sequence are acceptable for v1 because every read
 * sorts by position ascending and the absolute number is advisory.
 */
export async function leaveHalaqaWaitingList(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const admin = createAdminClient();

  const { data: deleted, error: delErr } = await admin
    .from("halaqa_waiting_list")
    .delete()
    .eq("session_id", sessionId)
    .eq("student_id", user.id)
    .is("promoted_at", null)
    .select("id");

  if (delErr) {
    logError("leaveHalaqaWaitingList: delete failed", delErr, {
      tag: "halaqa.waitlist",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: `فشل المغادرة: ${delErr.message}` };
  }

  if (!deleted || deleted.length === 0) {
    return { error: "لست في قائمة الانتظار" };
  }

  emitEvent("halaqa.waitlist_left", "session", sessionId, {
    student_id: user.id,
    session_id: sessionId,
  }, user.id).catch((err) =>
    logError("emit halaqa.waitlist_left failed", err, { tag: "halaqa.waitlist" }),
  );

  revalidatePath("/student/halaqas");
  revalidatePath(`/student/halaqas/${sessionId}`);
  return { ok: true };
}

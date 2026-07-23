"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import { callRpc } from "@/lib/supabase/rpc";

const uuidSchema = z.string().uuid();

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
 * Race-safe via the enroll_participant() SQL kernel (Task 10 / ADR-0004):
 * the participant INSERT and the capacity-guarded current_enrollment
 * increment run in one atomic transaction. A duplicate enrollment
 * (UNIQUE(session_id, user_id)) or a lost capacity race both abort the
 * whole function server-side, so there is never a half-enrolled state
 * for the app layer to compensate for.
 */
export async function enrollInHalaqa(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };
  if (!uuidSchema.safeParse(sessionId).success) return { error: "معرف غير صالح" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // AUTHZ-VULN-02: enforce the student role in-action (writes below bypass RLS
  // via the admin client; edge middleware is the only other guard).
  const { data: actorProfile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (actorProfile?.role !== "student") return { error: "هذا الإجراء متاح للطلاب فقط" };

  // admin: halaqa enrollment flows update the shared sessions.current_enrollment counter (student isn't the booking owner) and session_participants DELETE is admin-only (issue #523)
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

  // Atomic enroll: INSERT session_participants + capacity-guarded increment
  // of sessions.current_enrollment, one transaction (Task 10 / ADR-0004).
  // A lost capacity race or a duplicate enrollment aborts the whole
  // function server-side — no app-side compensating rollback needed.
  const { error: enrollErr } = await callRpc(admin, "enroll_participant", {
    p_session_id: sessionId,
    p_user_id: user.id,
  });

  if (enrollErr) {
    if (enrollErr.code === "23505") return { error: "أنت مسجل في هذه الحلقة بالفعل" };
    if (enrollErr.code === "P0003") return { error: "الحلقة ممتلئة" };
    logError("enrollInHalaqa: enroll_participant RPC failed", enrollErr, {
      tag: "halaqa.enroll",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: "فشل التسجيل" };
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
 * Cancel halaqa enrollment via the release_participant() SQL kernel
 * (Task 10 / ADR-0004): the participant DELETE and the floor-at-0
 * current_enrollment decrement run in one atomic transaction, so counter
 * drift against concurrent admin mutations is no longer possible.
 */
export async function cancelHalaqaEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) return { error: "session_id missing" };
  if (!uuidSchema.safeParse(sessionId).success) return { error: "معرف غير صالح" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // admin: halaqa enrollment flows update the shared sessions.current_enrollment counter (student isn't the booking owner) and session_participants DELETE is admin-only (issue #523)
  const admin = createAdminClient();

  // Atomic release: DELETE session_participants + floor-at-0 decrement of
  // sessions.current_enrollment, one transaction (Task 10 / ADR-0004).
  const { data: released, error: releaseErr } = await callRpc(admin, "release_participant", {
    p_session_id: sessionId,
    p_user_id: user.id,
  });

  if (releaseErr) {
    logError("cancelHalaqaEnrollment: release_participant RPC failed", releaseErr, {
      tag: "halaqa.cancel",
      metadata: { session_id: sessionId, user_id: user.id },
    });
    return { error: "فشل الإلغاء" };
  }

  if (!released) {
    return { error: "لست مسجلاً في هذه الحلقة" };
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
  if (!uuidSchema.safeParse(sessionId).success) return { error: "معرف غير صالح" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // AUTHZ-VULN-02: enforce the student role in-action (waitlist insert bypasses
  // RLS via the admin client; edge middleware is the only other guard).
  const { data: actorProfile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (actorProfile?.role !== "student") return { error: "هذا الإجراء متاح للطلاب فقط" };

  // admin: joinHalaqaWaitingList reads the max position across ALL waiters'
  // rows (RLS only shows the student their own), so the cross-student read
  // forces the service role. (issue #523)
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
    return { error: "فشل الانضمام إلى قائمة الانتظار" };
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
  if (!uuidSchema.safeParse(sessionId).success) return { error: "معرف غير صالح" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // Own-row delete: student_id = user.id. RLS halaqa_waiting_list_delete
  // permits this on the user client (issue #523 — swapped from admin).
  const { data: deleted, error: delErr } = await supabase
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
    return { error: "فشل المغادرة" };
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

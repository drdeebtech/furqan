"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

const uuidSchema = z.string().uuid();

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Student-initiated request to join a group halaqa. Creates a `pending`
 * booking for THIS student linked to the existing group session_id.
 * Teacher then confirms via the existing booking-approval flow on
 * /teacher/dashboard.
 *
 * Pricing/package-deduction is intentionally out of scope here — V1
 * creates a pending booking with amount_usd=0 and the admin or
 * teacher figures out billing context separately. Documented in
 * docs/PEDAGOGY_ROADMAP.md as a follow-up.
 */
export async function requestJoinGroupSession(sessionId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(sessionId).success) return { ok: false, error: "معرف غير صالح" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  // Look up the session: must exist, must be group, must be in the
  // future, must have seats remaining.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, capacity, current_enrollment, is_group, booking_id")
    .eq("id", sessionId)
    .single<{ id: string; capacity: number; current_enrollment: number; is_group: boolean; booking_id: string }>();
  if (!session) return { ok: false, error: "الجلسة غير موجودة" };
  if (!session.is_group) return { ok: false, error: "هذه ليست حلقة جماعية" };

  // Pull the source booking (the one that created the session) for
  // teacher_id, scheduled_at, duration_min, session_type.
  const { data: sourceBooking } = await supabase
    .from("bookings")
    .select("teacher_id, scheduled_at, duration_min, session_type, amount_usd")
    .eq("id", session.booking_id)
    .single<{ teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; amount_usd: number | null }>();
  if (!sourceBooking) return { ok: false, error: "الحجز المصدر غير موجود" };

  // Sanity: in the future
  if (new Date(sourceBooking.scheduled_at).getTime() < Date.now()) {
    return { ok: false, error: "هذه الحلقة منتهية" };
  }

  // Advisory snapshot for early rejection only. The real race guard is
  // the atomic current_enrollment UPDATE below (same pattern as halaqa
  // enrollment — fixes TOCTOU where two students race through this check).
  if (session.current_enrollment >= session.capacity) {
    return { ok: false, error: "لا توجد مقاعد متاحة" };
  }

  // admin: joins group session — updates sessions.current_enrollment on a row the student doesn't own (issue #523)
  const admin = createAdminClient();

  // Already-enrolled check (admin client for consistency with insert below).
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("student_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return { ok: false, error: "أنت مسجَّل بالفعل" };

  // Create a pending booking. amount_usd=0 (billing handled separately
  // in V1; documented in PEDAGOGY_ROADMAP.md).
  //
  // Phase 4f retention: the cast bridges a generated-types-vs-db-default
  // mismatch. `rate_snapshot` has a Postgres DEFAULT but the Supabase
  // generated Insert type marks it required. Postgres fills it at runtime;
  // dropping the cast surfaces a misleading "Property 'rate_snapshot' is
  // missing" error. Same category as Phase 4d's count:"exact" retention.
  const { data: newBooking, error: insErr } = await admin
    .from("bookings")
    .insert({
      student_id: user.id,
      teacher_id: sourceBooking.teacher_id,
      session_id: sessionId,
      scheduled_at: sourceBooking.scheduled_at,
      duration_min: sourceBooking.duration_min,
      session_type: sourceBooking.session_type,
      amount_usd: 0,
      status: "pending",
    } as TableInsert<"bookings">)
    .select("id")
    .single<{ id: string }>();

  if (insErr || !newBooking) {
    if (insErr?.code === "23505") return { ok: false, error: "أنت مسجَّل بالفعل" };
    logError("requestJoinGroupSession: booking insert failed", insErr, {
      tag: "group-sessions",
      sessionId,
      studentId: user.id,
    });
    return { ok: false, error: "فشل التسجيل" };
  }

  // Atomic capacity guard — mirrors halaqa enrollment.
  // If two students race, only one UPDATE wins the `current_enrollment < capacity`
  // check. The loser gets no row back and we roll back their booking insert.
  const { data: updatedSession, error: updErr } = await admin
    .from("sessions")
    .update({ current_enrollment: session.current_enrollment + 1 })
    .eq("id", sessionId)
    .eq("current_enrollment", session.current_enrollment)
    .lt("current_enrollment", session.capacity)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updErr || !updatedSession) {
    const { error: rollbackErr } = await admin
      .from("bookings")
      .delete()
      .eq("id", newBooking.id);
    if (rollbackErr) {
      logError("requestJoinGroupSession: rollback delete failed", rollbackErr, {
        tag: "group-sessions",
        metadata: { booking_id: newBooking.id, session_id: sessionId },
      });
    }

    if (updErr) {
      logError("requestJoinGroupSession: enrollment counter update failed", updErr, {
        tag: "group-sessions",
        sessionId,
      });
      return { ok: false, error: "فشل تحديث العداد" };
    }
    return { ok: false, error: "لا توجد مقاعد متاحة" };
  }

  // Fire-and-forget event so n8n can notify the teacher. entity_id MUST be the
  // new booking id, not the session id (audit H14) — consumers resolve the
  // booking by entity_id, and automation_logs would otherwise carry a session
  // id tagged entity_type=booking. The session id is kept in the payload.
  emitEvent("booking.created", "booking", newBooking.id, {
    student_id: user.id,
    teacher_id: sourceBooking.teacher_id,
    session_id: sessionId,
    session_type: sourceBooking.session_type,
    scheduled_at: sourceBooking.scheduled_at,
    is_group_join: true,
  }).catch((err) => logError("emit booking.created failed (group join)", err, {
    tag: "automation", event: "booking.created",
  }));

  revalidatePath("/student/group-sessions");
  revalidatePath("/student/sessions");
  revalidatePath("/teacher/dashboard");

  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  // Look up the session: must exist, must be group, must be in the
  // future, must have seats remaining.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, capacity, is_group, booking_id")
    .eq("id", sessionId)
    .single<{ id: string; capacity: number; is_group: boolean; booking_id: string }>();
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

  // Seats remaining check.
  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("deleted_at", null);
  if (count !== null && count >= session.capacity) {
    return { ok: false, error: "لا توجد مقاعد متاحة" };
  }

  // Already-enrolled check.
  const { data: existing } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("student_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return { ok: false, error: "أنت مسجَّل بالفعل" };

  // Create a pending booking. amount_usd=0 (billing handled separately
  // in V1; documented in PEDAGOGY_ROADMAP.md).
  const { error } = await supabase
    .from("bookings")
    .insert({
      student_id: user.id,
      teacher_id: sourceBooking.teacher_id,
      session_id: sessionId,
      scheduled_at: sourceBooking.scheduled_at,
      duration_min: sourceBooking.duration_min,
      // sourceBooking.session_type comes from a generic-string select; the
      // column is the session_type enum. Narrowing cast documents the
      // expected type.
      session_type: sourceBooking.session_type as "tajweed" | "qiraat" | "tafsir" | "hifz" | "muraja" | "tilawa" | "combined" | "other",
      amount_usd: 0,
      status: "pending",
    });

  if (error) {
    logError("requestJoinGroupSession failed", error, {
      tag: "group-sessions",
      sessionId,
      studentId: user.id,
    });
    return { ok: false, error: "فشل التسجيل" };
  }

  // Fire-and-forget event so n8n can notify the teacher.
  emitEvent("booking.created", "booking", sessionId, {
    student_id: user.id,
    teacher_id: sourceBooking.teacher_id,
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { notify } from "@/lib/notifications/dispatcher";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

// NOTE: studentPreflight authenticates only (any signed-in user); it does not
// role-gate, and its unauthenticated message ("غير مسجل الدخول") differs from
// routeAction's forbidden message. Migrating to routeAction({ role: "student" })
// would change both, so this adapter keeps its loudAction preflight and only
// adopts the shared UserError. Follow-up: align on routeAction once the
// role-gate + message change is intentional.
async function studentPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  return { actorId: user.id };
}

/**
 * Sprint 2.3 — Talqeen primitive (2026-05-05).
 *
 * Talqeen is the canonical Quran-pedagogy loop: teacher recites, student
 * echoes, teacher corrects. The platform's video sessions covered the
 * "talk together" half of that loop but had no structured way for the
 * student to send a recording for correction. This action creates the
 * scaffold follow-up row that the AudioRecorder client component then
 * fills with the actual audio.
 *
 * The resulting homework_assignments row has:
 *   - homework_type='recitation'
 *   - status='assigned' (will flip to 'student_ready' when audio uploads
 *     via the existing markStudentReady action)
 *   - title=auto-generated ("Talqeen recitation — <date>")
 *   - teacher_id pulled from the booking
 *   - booking_id linking back to the originating session
 *
 * The teacher gets a notification when the audio actually lands — not
 * here. This action just opens the slot.
 */
const createTalqeenHomeworkBase = loudAction<{ bookingId: string }, { message: string }>({
  name: "homework.create-talqeen",
  // P1 lifecycle entry. severity=info — routine talqeen slot opens.
  severity: "info",
  schema: z.object({ bookingId: z.string().uuid() }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => `talqeen:${i.bookingId}`,
    action: "INSERT",
    reasonPrefix: "student create talqeen follow-up",
  },
  preflight: studentPreflight,
  handler: async ({ bookingId }, { actorId }) => {
    const supabase = await createClient();

    // Verify the booking belongs to this student (RLS gates this anyway).
    // Pull teacher_id + scheduled_at to populate the follow-up row.
    // Capture both data and error: PGRST116 = no row (business case),
    // anything else = real infra (cause attached for Sentry).
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, teacher_id, student_id, scheduled_at, session_id")
      .eq("id", bookingId)
      .single<{
        id: string;
        teacher_id: string;
        student_id: string;
        scheduled_at: string;
        session_id: string | null;
      }>();

    if (bookingErr && bookingErr.code !== "PGRST116") {
      throw new UserError("الجلسة غير موجودة", { cause: bookingErr });
    }
    if (!booking || booking.student_id !== actorId) {
      throw new UserError("الجلسة غير موجودة");
    }

    const sessionDate = new Date(booking.scheduled_at).toLocaleDateString("ar-EG", {
      month: "long", day: "numeric",
    });
    const title = `تسميع تلقين — ${sessionDate}`;
    const description = "تسميع أرسله الطالب أثناء الجلسة لطلب تصحيح المعلم.";

    const { data: hw, error: insertErr } = await supabase
      .from("homework_assignments")
      .insert({
        booking_id: bookingId,
        session_id: booking.session_id,
        teacher_id: booking.teacher_id,
        student_id: actorId,
        homework_type: "recitation",
        status: "assigned",
        title,
        description,
      })
      .select("id")
      .single<{ id: string }>();

    if (insertErr || !hw) {
      throw new UserError("فشل إنشاء طلب التسميع", { cause: insertErr ?? new Error("no row returned") });
    }

    // Light notification to teacher that a recording slot has opened — they
    // get a louder one when the audio actually lands via markStudentReady.
    try {
      await notify({
        userId: booking.teacher_id,
        type: "homework",
        title: "طلب تسميع جديد",
        body: `الطالب أنشأ طلب تسميع من جلسة ${sessionDate} — سيصل الصوت قريباً.`,
        entityType: "homework",
        entityId: hw.id,
      });
    } catch (err) {
      logError("createTalqeenHomework: notify failed", err, {
        tag: "talqeen",
        metadata: { teacher_id: booking.teacher_id, homeworkId: hw.id },
      });
    }

    revalidatePath(`/student/sessions/${booking.session_id ?? ""}`);
    // homeworkId carried via the `message` slot — the public wrapper
    // remaps it back to the caller's expected `{ ok, homeworkId }` shape.
    // Same pattern as updateEmail's notice in PR 12.
    return { message: hw.id };
  },
});

export async function createTalqeenHomework(
  bookingId: string,
): Promise<{ ok: true; homeworkId: string } | { ok: false; error: string }> {
  const result = await createTalqeenHomeworkBase({ bookingId });
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.message) return { ok: false, error: "خطأ غير متوقع" };
  return { ok: true, homeworkId: result.message };
}

/**
 * Delete an unsubmitted talqeen slot (status='assigned', no audio yet).
 * Called when the student cancels before recording so orphaned rows
 * don't accumulate in homework_assignments.
 */
const cancelTalqeenHomeworkBase = loudAction<{ homeworkId: string }, void>({
  name: "homework.cancel-talqeen",
  severity: "info",
  schema: z.object({ homeworkId: z.string().uuid() }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "DELETE",
    reasonPrefix: "student cancel talqeen",
  },
  preflight: studentPreflight,
  handler: async ({ homeworkId }, { actorId }) => {
    const supabase = await createClient();
    const { data: deleted } = await supabase
      .from("homework_assignments")
      .delete()
      .eq("id", homeworkId)
      .eq("student_id", actorId!)
      .eq("status", "assigned") // guard: never delete a row already graded
      .select("id")
      .returns<{ id: string }[]>();
    if (!deleted?.length) {
      logError("cancelTalqeenHomework: no row deleted — stale or already graded", null, {
        tag: "talqeen", metadata: { homeworkId, student_id: actorId },
      });
    }
    revalidatePath("/student/sessions");
  },
});

export async function cancelTalqeenHomework(homeworkId: string): Promise<void> {
  if (!homeworkId) return;
  await cancelTalqeenHomeworkBase({ homeworkId }).catch(() => {});
}

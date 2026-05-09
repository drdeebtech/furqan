"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { notify } from "@/lib/notifications/dispatcher";
import { loudAction } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

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
    const { data: booking } = await supabase
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
  // result.message is the homeworkId — guaranteed defined when ok=true
  // because the handler always returns { message: hw.id }.
  return { ok: true, homeworkId: result.message ?? "" };
}

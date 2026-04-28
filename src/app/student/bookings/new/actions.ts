"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import type { SessionType } from "@/types/database";
import { notifyNewBooking } from "@/lib/whatsapp";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

export type BookingResult = {
  error?: string;
};

const SESSION_TYPES = ["hifz", "muraja", "tajweed", "tilawa", "qiraat", "tafsir", "combined", "other"] as const;

const BookingSchema = z.object({
  teacher_id: z.string().uuid(),
  session_type: z.enum(SESSION_TYPES),
  duration_min: z.coerce.number().int().refine((n) => [30, 45, 60].includes(n), { message: "مدة غير صالحة" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z
    .string()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const MAX_BOOKINGS_PER_HOUR = 10;

/**
 * DB-backed rate limiter. Writes each attempt to automation_logs and counts
 * entries for this user in the last hour. Works across Fluid Compute instances
 * (no per-instance state) and survives cold starts. Cost: one DB query per call.
 */
async function checkRateLimit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("automation_logs")
    .select("id", { count: "exact", head: true })
    .eq("workflow_name", "booking-attempt")
    .eq("entity_id", userId)
    .gte("started_at", oneHourAgo);

  if ((count ?? 0) >= MAX_BOOKINGS_PER_HOUR) return false;

  const now = new Date().toISOString();
  await supabase.from("automation_logs").insert({
    workflow_name: "booking-attempt",
    event_name: "booking.attempt",
    entity_type: "user",
    entity_id: userId,
    status: "succeeded",
    started_at: now,
    finished_at: now,
  } as never);
  return true;
}

export async function createBooking(
  _prev: BookingResult,
  formData: FormData,
): Promise<BookingResult> {
  const verification = await checkBotId();
  if (verification.isBot) {
    return { error: "تعذر التحقق من الطلب" };
  }

  const parsed = BookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const msgMap: Record<string, string> = {
      teacher_id: "معلم غير صالح",
      session_type: "نوع الجلسة غير صالح",
      duration_min: "مدة غير صالحة",
      date: "تاريخ غير صالح",
      time: "وقت غير صالح",
    };
    const field = firstIssue?.path[0]?.toString() ?? "";
    return { error: msgMap[field] ?? firstIssue?.message ?? "جميع الحقول مطلوبة" };
  }
  const { teacher_id: teacherId, session_type: sessionType, duration_min: durationMin, date, time, notes } = parsed.data;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "يجب تسجيل الدخول أولاً" };

  const studentId = user.id;

  // Durable rate limiting — DB-backed so it works across Fluid Compute instances
  try {
    if (!(await checkRateLimit(supabase, studentId))) {
      return { error: "لقد تجاوزت الحد المسموح — حاول لاحقاً" };
    }
  } catch (err) {
    logError("Booking rate-limit check failed — allowing request", err, { tag: "booking-rate-limit" });
    // Fail-open so a transient DB blip doesn't block legitimate bookings
  }

  // Fetch teacher rate server-side (Fix #3: never trust client-provided rate)
  const { data: teacherProfile } = await supabase
    .from("teacher_profiles")
    .select("hourly_rate, specialties")
    .eq("teacher_id", teacherId)
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .single<{ hourly_rate: number; specialties: string[] }>();

  if (!teacherProfile) {
    return { error: "المعلم غير متاح حالياً" };
  }

  // Validate session type is in teacher's specialties (skip if teacher has no specialties set)
  if (teacherProfile.specialties.length > 0 && !teacherProfile.specialties.includes(sessionType)) {
    return { error: "نوع الجلسة غير مدعوم من هذا المعلم" };
  }

  const rateSnapshot = Number(teacherProfile.hourly_rate);

  const scheduledAt = new Date(`${date}T${time}:00`);

  if (isNaN(scheduledAt.getTime())) {
    return { error: "تاريخ أو وقت غير صالح" };
  }

  // Allow bookings up to 30 minutes in the past (for instant/agreed sessions)
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  if (scheduledAt < thirtyMinsAgo) {
    return { error: "يجب اختيار وقت صالح" };
  }

  // Validate against teacher availability (Fix #8)
  const dayOfWeek = scheduledAt.getDay();
  const timeStr = time.length === 5 ? `${time}:00` : time; // ensure HH:MM:SS

  const { data: slots } = await supabase
    .from("teacher_availability")
    .select("start_time, end_time, slot_duration")
    .eq("teacher_id", teacherId)
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)
    .returns<{ start_time: string; end_time: string; slot_duration: number }[]>();

  type Slot = { start_time: string; end_time: string; slot_duration: number };
  if (slots && slots.length > 0) {
    const timeOnly = timeStr.slice(0, 5); // HH:MM
    const fitsSlot = slots.some(
      (s: Slot) => timeOnly >= s.start_time.slice(0, 5) && timeOnly < s.end_time.slice(0, 5),
    );
    if (!fitsSlot) {
      return { error: "الوقت المختار خارج أوقات المعلم المتاحة" };
    }

    // Fix #14: Check duration doesn't exceed slot
    const matchingSlot = slots.find(
      (s: Slot) => timeOnly >= s.start_time.slice(0, 5) && timeOnly < s.end_time.slice(0, 5),
    );
    if (matchingSlot && durationMin > matchingSlot.slot_duration) {
      return {
        error: `المدة المختارة (${durationMin} دقيقة) أطول من الحد المتاح (${matchingSlot.slot_duration} دقيقة)`,
      };
    }
  }

  // Check availability exceptions (Fix #8)
  const dateStr = date; // YYYY-MM-DD
  const { data: exceptions } = await supabase
    .from("availability_exceptions")
    .select("is_blocked, start_time, end_time")
    .eq("teacher_id", teacherId)
    .eq("date", dateStr)
    .returns<{ is_blocked: boolean; start_time: string | null; end_time: string | null }[]>();

  type Exception = { is_blocked: boolean; start_time: string | null; end_time: string | null };
  if (exceptions && exceptions.length > 0) {
    const blocked = exceptions.some((ex: Exception) => {
      if (ex.is_blocked) {
        // Full day blocked
        if (!ex.start_time && !ex.end_time) return true;
        // Time range blocked
        const t = timeStr.slice(0, 5);
        if (ex.start_time && ex.end_time) {
          return t >= ex.start_time.slice(0, 5) && t < ex.end_time.slice(0, 5);
        }
      }
      return false;
    });
    if (blocked) {
      return { error: "المعلم غير متاح في هذا التاريخ — اختر تاريخاً آخر" };
    }
  }

  const amountUsd = Number((rateSnapshot * (durationMin / 60)).toFixed(2));

  const { data: newBooking, error } = await supabase
    .from("bookings")
    .insert({
      student_id: studentId,
      teacher_id: teacherId,
      session_type: sessionType as SessionType,
      duration_min: durationMin,
      rate_snapshot: rateSnapshot,
      amount_usd: amountUsd,
      scheduled_at: scheduledAt.toISOString(),
      notes,
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.message.includes("no_booking_overlap")) {
      return { error: "هذا الوقت محجوز بالفعل — اختر وقتاً آخر" };
    }
    return { error: "حدث خطأ أثناء إنشاء الحجز" };
  }

  // Send notifications in parallel (non-blocking)
  await Promise.allSettled([
    // Notify teacher about new booking
    notify(teacherId, "booking", "حجز جديد", `لديك حجز جديد بتاريخ ${scheduledAt.toLocaleDateString("ar")} — يرجى التأكيد`, "booking", newBooking?.id ?? undefined),
    // WhatsApp notification to admin
    (async () => {
      const [{ data: studentProfile }, { data: teacherName }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>(),
        supabase.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>(),
      ]);
      await notifyNewBooking(
        studentProfile?.full_name ?? "طالب",
        teacherName?.full_name ?? "معلم",
        scheduledAt.toLocaleDateString("ar"),
      );
    })(),
    emitEvent("booking.created", "booking", newBooking?.id ?? "", { student_id: studentId, teacher_id: teacherId, session_type: sessionType, scheduled_at: scheduledAt.toISOString() }).catch((err) => logError("emit booking.created failed", err, { tag: "automation", actionName: "booking.created" })),
  ]);

  redirect("/student/dashboard?booked=1");
}

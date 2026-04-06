"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionType } from "@/types/database";
import { notifyNewBooking } from "@/lib/whatsapp";

export type BookingResult = {
  error?: string;
};

// Simple in-memory rate limiter per user (resets on server restart)
const bookingAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_BOOKINGS_PER_HOUR = 10;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = bookingAttempts.get(userId);
  if (!entry || now > entry.resetAt) {
    bookingAttempts.set(userId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= MAX_BOOKINGS_PER_HOUR) return false;
  entry.count++;
  return true;
}

export async function createBooking(
  _prev: BookingResult,
  formData: FormData,
): Promise<BookingResult> {
  const teacherId = formData.get("teacher_id") as string;
  const sessionType = formData.get("session_type") as string;
  const durationMin = Number(formData.get("duration_min"));
  const date = formData.get("date") as string;
  const time = formData.get("time") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!teacherId || !sessionType || !durationMin || !date || !time) {
    return { error: "جميع الحقول مطلوبة" };
  }

  if (![30, 45, 60].includes(durationMin)) {
    return { error: "مدة غير صالحة" };
  }

  const supabase = await createClient();

  // Get authenticated user server-side (Fix #2: never trust client-provided student_id)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "يجب تسجيل الدخول أولاً" };

  const studentId = user.id;

  // Rate limiting (Fix #13)
  if (!checkRateLimit(studentId)) {
    return { error: "لقد تجاوزت الحد المسموح — حاول لاحقاً" };
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

  // Notify teacher about new booking
  try {
    await supabase.from("notifications").insert({
      user_id: teacherId,
      type: "booking",
      title: "حجز جديد",
      body: `لديك حجز جديد بتاريخ ${scheduledAt.toLocaleDateString("ar-SA")} — يرجى التأكيد`,
      data: { booking_id: newBooking?.id ?? null },
      channel: ["in_app"],
    } as never);
  } catch { /* non-blocking */ }

  // WhatsApp notification to admin
  try {
    const { data: studentProfile } = await supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>();
    const { data: teacherName } = await supabase.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>();
    await notifyNewBooking(
      studentProfile?.full_name ?? "طالب",
      teacherName?.full_name ?? "معلم",
      scheduledAt.toLocaleDateString("ar-SA"),
    );
  } catch { /* non-blocking */ }

  redirect("/student/dashboard?booked=1");
}

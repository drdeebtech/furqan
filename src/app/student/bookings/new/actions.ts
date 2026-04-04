"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionType } from "@/types/database";

export type BookingResult = {
  error?: string;
};

export async function createBooking(
  _prev: BookingResult,
  formData: FormData,
): Promise<BookingResult> {
  const studentId = formData.get("student_id") as string;
  const teacherId = formData.get("teacher_id") as string;
  const sessionType = formData.get("session_type") as string;
  const durationMin = Number(formData.get("duration_min"));
  const rateSnapshot = Number(formData.get("rate_snapshot"));
  const date = formData.get("date") as string;
  const time = formData.get("time") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!studentId || !teacherId || !sessionType || !durationMin || !date || !time) {
    return { error: "جميع الحقول مطلوبة" };
  }

  if (![30, 45, 60].includes(durationMin)) {
    return { error: "مدة غير صالحة" };
  }

  const scheduledAt = new Date(`${date}T${time}`);
  if (scheduledAt <= new Date()) {
    return { error: "يجب اختيار وقت في المستقبل" };
  }

  const amountUsd = Number((rateSnapshot * (durationMin / 60)).toFixed(2));

  const supabase = await createClient();

  // Hand-written Database types cause postgrest generics to resolve to `never`.
  // The database CHECK constraints + triggers are the real type validators.
  // This will be replaced when we switch to `supabase gen types typescript`.
  const { error } = await supabase.from("bookings").insert({
    student_id: studentId,
    teacher_id: teacherId,
    session_type: sessionType as SessionType,
    duration_min: durationMin,
    rate_snapshot: rateSnapshot,
    amount_usd: amountUsd,
    scheduled_at: scheduledAt.toISOString(),
    notes,
  } as never);

  if (error) {
    if (error.message.includes("no_booking_overlap")) {
      return { error: "هذا الوقت محجوز بالفعل — اختر وقتاً آخر" };
    }
    return { error: "حدث خطأ أثناء إنشاء الحجز" };
  }

  redirect("/student/bookings");
}

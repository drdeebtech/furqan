"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityResult = {
  error?: string;
};

export async function addSlot(
  _prev: AvailabilityResult,
  formData: FormData,
): Promise<AvailabilityResult> {
  const dayOfWeek = Number(formData.get("day_of_week"));
  const startTime = formData.get("start_time") as string;
  const endTime = formData.get("end_time") as string;
  const slotDuration = Number(formData.get("slot_duration"));

  if (isNaN(dayOfWeek) || !startTime || !endTime || !slotDuration) {
    return { error: "جميع الحقول مطلوبة" };
  }

  if (startTime >= endTime) {
    return { error: "وقت البداية يجب أن يكون قبل وقت النهاية" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase.from("teacher_availability").insert({
    teacher_id: user.id,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    slot_duration: slotDuration,
  } as never);

  if (error) {
    if (error.message.includes("avail_unique")) {
      return { error: "هذا الموعد موجود بالفعل" };
    }
    return { error: "حدث خطأ أثناء إضافة الموعد" };
  }

  revalidatePath("/teacher/availability");
  return {};
}

export async function deleteSlot(slotId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("teacher_availability")
    .delete()
    .eq("id", slotId)
    .eq("teacher_id", user.id);

  if (error) {
    return { error: "حدث خطأ أثناء حذف الموعد" };
  }

  revalidatePath("/teacher/availability");
  return { success: true };
}

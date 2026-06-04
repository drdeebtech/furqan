"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

// Defense-in-depth role preflight. The edge middleware (proxy.ts) already
// blocks non-teachers, but server actions are reachable without it in direct
// POST / test scenarios — so we gate at the action layer too.
async function requireTeacherActor(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["teacher", "admin"].includes(profile.role)) {
    throw new UserError("ليس لديك صلاحية");
  }
  return { actorId: user.id };
}

const addSlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "وقت البداية غير صالح"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "وقت النهاية غير صالح"),
  slot_duration: z.number().int().min(15).max(180),
});

const addSlotBase = loudAction<z.infer<typeof addSlotSchema>, { message: string }>({
  name: "teacher.availability.add-slot",
  severity: "info",
  schema: addSlotSchema,
  audit: {
    table: "teacher_availability",
    recordId: (_i, actorId) => actorId ?? "unknown",
    action: "INSERT",
    reasonPrefix: "teacher add availability slot",
  },
  preflight: requireTeacherActor,
  handler: async (input, { actorId }) => {
    if (input.start_time >= input.end_time) {
      throw new UserError("وقت البداية يجب أن يكون قبل وقت النهاية");
    }

    const supabase = await createClient();
    const { error } = await supabase.from("teacher_availability").insert({
      teacher_id: actorId as string,
      day_of_week: input.day_of_week,
      start_time: input.start_time,
      end_time: input.end_time,
      slot_duration: input.slot_duration,
    });

    if (error) {
      if (error.message.includes("avail_unique")) {
        throw new UserError("هذا الموعد موجود بالفعل");
      }
      throw new UserError("حدث خطأ أثناء إضافة الموعد — يرجى المحاولة مرة أخرى", { cause: error });
    }

    revalidatePath("/teacher/availability");

    await emitEvent("teacher.availability_slot_added", "teacher_availability", actorId as string, {
      teacher_id: actorId,
      day_of_week: input.day_of_week,
      start_time: input.start_time,
      end_time: input.end_time,
    }).catch((err) => logError("addSlot: emitEvent failed", err, { tag: "teacher-availability" }));

    return { message: "تمت إضافة الموعد بنجاح" };
  },
});

export async function addSlot(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const dayOfWeek = Number(formData.get("day_of_week"));
  const startTime = formData.get("start_time") as string;
  const endTime = formData.get("end_time") as string;
  const slotDuration = Number(formData.get("slot_duration"));

  return addSlotBase({ day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, slot_duration: slotDuration });
}

const deleteSlotBase = loudAction<{ slotId: string }, { message: string }>({
  name: "teacher.availability.delete-slot",
  severity: "info",
  schema: z.object({ slotId: z.string().uuid("معرّف الموعد غير صالح") }),
  audit: {
    table: "teacher_availability",
    recordId: (i) => i.slotId,
    action: "DELETE",
    reasonPrefix: "teacher delete availability slot",
  },
  preflight: requireTeacherActor,
  handler: async ({ slotId }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_availability")
      .delete()
      .eq("id", slotId)
      .eq("teacher_id", actorId as string);

    if (error) {
      throw new UserError("حدث خطأ أثناء حذف الموعد — يرجى المحاولة مرة أخرى", { cause: error });
    }

    revalidatePath("/teacher/availability");

    await emitEvent("teacher.availability_slot_deleted", "teacher_availability", actorId as string, {
      teacher_id: actorId,
      slot_id: slotId,
    }).catch((err) => logError("deleteSlot: emitEvent failed", err, { tag: "teacher-availability" }));

    return { message: "تم حذف الموعد بنجاح" };
  },
});

export async function deleteSlot(slotId: string): Promise<LoudResult> {
  return deleteSlotBase({ slotId });
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { SessionType } from "@/types/database";

const VALID_TYPES: ReadonlySet<SessionType> = new Set([
  "hifz", "muraja", "tajweed", "tilawa", "qiraat", "tafsir", "combined", "other",
]);

interface CreateInput {
  title: string;
  description?: string | null;
  scheduled_at: string;          // ISO timestamp
  duration_min: number;
  session_type: string;
  capacity: number;
  price_usd: number;
}

/**
 * Teacher publishes a group-class offering. Students browse + self-enroll
 * in Phase 3. RLS already restricts access to the publishing teacher; we
 * still validate inputs here so bad data never lands in the table.
 */
export async function createOffering(input: CreateInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const title = input.title?.trim() ?? "";
  if (title.length < 1 || title.length > 200) return { error: "العنوان مطلوب ولا يتجاوز 200 حرف" };
  if (!VALID_TYPES.has(input.session_type as SessionType)) return { error: "نوع الجلسة غير صالح" };
  if (!Number.isInteger(input.duration_min) || input.duration_min < 15 || input.duration_min > 240) {
    return { error: "المدة يجب أن تكون بين 15 و 240 دقيقة" };
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 20) {
    return { error: "السعة يجب أن تكون بين 2 و 20 طالباً" };
  }
  if (typeof input.price_usd !== "number" || input.price_usd < 0) {
    return { error: "السعر غير صالح" };
  }
  const scheduledMs = Date.parse(input.scheduled_at);
  if (Number.isNaN(scheduledMs)) return { error: "تاريخ الجلسة غير صالح" };
  if (scheduledMs < Date.now() - 60_000) return { error: "لا يمكن جدولة جلسة في الماضي" };

  const { data, error } = await supabase
    .from("class_offerings")
    .insert({
      teacher_id: user.id,
      title,
      description: input.description?.trim() || null,
      scheduled_at: input.scheduled_at,
      duration_min: input.duration_min,
      session_type: input.session_type as SessionType,
      capacity: input.capacity,
      price_usd: input.price_usd,
      status: "open",
    } satisfies TableInsert<"class_offerings">)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    logError("createOffering insert failed", error, { tag: "class-offerings", metadata: { userId: user.id } });
    return { error: "فشل إنشاء الجلسة الجماعية — " + (error?.message ?? "خطأ غير معروف") };
  }

  revalidatePath("/teacher/classes");
  return { success: true as const, id: data.id };
}

interface UpdateInput extends Partial<CreateInput> {
  status?: "open" | "full" | "confirmed" | "cancelled" | "completed";
}

export async function updateOffering(id: string, patch: UpdateInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: existing } = await supabase
    .from("class_offerings")
    .select("id, teacher_id, status")
    .eq("id", id)
    .single<{ id: string; teacher_id: string; status: string }>();
  if (!existing) return { error: "الجلسة الجماعية غير موجودة" };
  if (existing.teacher_id !== user.id) return { error: "ليست جلستك" };
  if (existing.status === "completed" || existing.status === "cancelled") {
    return { error: "لا يمكن تعديل جلسة منتهية أو ملغاة" };
  }

  // Build a tight update payload — only fields actually provided.
  const update: TableUpdate<"class_offerings"> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 1 || t.length > 200) return { error: "العنوان مطلوب" };
    update.title = t;
  }
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.scheduled_at !== undefined) {
    const ms = Date.parse(patch.scheduled_at);
    if (Number.isNaN(ms)) return { error: "تاريخ غير صالح" };
    update.scheduled_at = patch.scheduled_at;
  }
  if (patch.duration_min !== undefined) {
    if (!Number.isInteger(patch.duration_min) || patch.duration_min < 15 || patch.duration_min > 240) {
      return { error: "المدة 15..240 دقيقة" };
    }
    update.duration_min = patch.duration_min;
  }
  if (patch.session_type !== undefined) {
    if (!VALID_TYPES.has(patch.session_type as SessionType)) return { error: "نوع غير صالح" };
    update.session_type = patch.session_type as SessionType;
  }
  if (patch.capacity !== undefined) {
    if (!Number.isInteger(patch.capacity) || patch.capacity < 2 || patch.capacity > 20) {
      return { error: "السعة 2..20" };
    }
    update.capacity = patch.capacity;
  }
  if (patch.price_usd !== undefined) {
    if (typeof patch.price_usd !== "number" || patch.price_usd < 0) return { error: "السعر غير صالح" };
    update.price_usd = patch.price_usd;
  }
  if (patch.status !== undefined) update.status = patch.status;

  const { error } = await supabase
    .from("class_offerings")
    .update(update)
    .eq("id", id);

  if (error) return { error: "فشل التعديل — " + error.message };

  revalidatePath("/teacher/classes");
  revalidatePath(`/teacher/classes/${id}`);
  return { success: true as const };
}

export async function cancelOffering(id: string, reason?: string) {
  const res = await updateOffering(id, { status: "cancelled" });
  if (!res || "error" in res) return res;
  if (reason) {
    const supabase = await createClient();
    await supabase.from("class_offerings").update({
      description: `[CANCELLED] ${reason}`,
    } as never).eq("id", id);
  }
  return res;
}

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

export type ActionResult = { error?: string; success?: boolean; notice?: string };

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function num(formData: FormData, key: string): number | null {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function revalidateTeacher(_teacherId: string) {
  revalidatePath("/admin/teachers/[id]", "page");
  revalidatePath("/admin/teachers");
  revalidatePath("/admin/teachers/cv");
}

// ─── Account (profiles row) ────────────────────────────────────────────

export async function updateAccount(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: str(formData, "full_name"),
      full_name_ar: str(formData, "full_name_ar"),
      phone: str(formData, "phone"),
      country: str(formData, "country"),
      timezone: str(formData, "timezone"),
      lang: str(formData, "lang"),
      avatar_url: str(formData, "avatar_url"),
      date_of_birth: str(formData, "date_of_birth"),
      parent_name: str(formData, "parent_name"),
      parent_phone: str(formData, "parent_phone"),
      parent_email: str(formData, "parent_email"),
      is_active: bool(formData, "is_active"),
    } as TableUpdate<"profiles">)
    .eq("id", teacherId);

  if (error) {
    logError("admin updateAccount failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId } });
    return { error: "فشل حفظ بيانات الحساب" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function updateEmail(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const email = str(formData, "email");
  if (!email) return { error: "البريد الإلكتروني مطلوب" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(teacherId, {
    email,
  });

  if (error) return { error: error.message };

  revalidateTeacher(teacherId);
  return {
    success: true,
    notice: "تم إرسال رابط التأكيد إلى البريد الجديد — لن يتغير البريد حتى يضغط المعلم على الرابط.",
  };
}

export async function uploadTeacherPhoto(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const photoFile = formData.get("photo");
  if (!(photoFile instanceof File) || photoFile.size === 0) {
    return { error: "يرجى اختيار صورة" };
  }
  if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
    return { error: "نوع الملف غير مدعوم — JPG / PNG / WebP فقط" };
  }
  if (photoFile.size > MAX_PHOTO_BYTES) {
    return { error: "الملف كبير جدًا — الحد الأقصى 2 ميغابايت" };
  }

  const adminClient = createAdminClient();
  const ext = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
  const path = `${teacherId}/${Date.now()}.${ext}`;

  const { error: upErr } = await adminClient.storage
    .from("teacher-avatars")
    .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
  if (upErr) {
    logError("admin teacher photo upload failed", upErr, { tag: "admin-teacher-photo" });
    return { error: "فشل رفع الصورة — يرجى المحاولة مرة أخرى" };
  }

  const { data: pub } = adminClient.storage.from("teacher-avatars").getPublicUrl(path);
  const avatarUrl = pub?.publicUrl ?? null;
  if (!avatarUrl) return { error: "تعذر إنشاء رابط الصورة" };

  const { error: updErr } = await adminClient
    .from("profiles")
    .update({ avatar_url: avatarUrl } satisfies TableUpdate<"profiles">)
    .eq("id", teacherId);
  if (updErr) {
    logError("admin teacher photo profile update failed", updErr, { tag: "admin-teacher-photo" });
    return { error: "تم رفع الصورة لكن فشل حفظها" };
  }

  revalidateTeacher(teacherId);
  revalidatePath("/teachers");
  revalidateTag("teachers-public", "max"); // Next.js Data Cache
  await invalidateByTag("teachers-public"); // CDN edge cache
  return { success: true };
}

// ─── Teacher profile (teacher_profiles, non-CV fields) ─────────────────

export async function updateTeacherProfile(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const hourlyRate = num(formData, "hourly_rate");
  const maxActive = num(formData, "max_active_students");

  const supabase = await createClient();
  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      hourly_rate: hourlyRate ?? undefined,
      gender: str(formData, "gender"),
      max_active_students: maxActive ?? undefined,
      is_accepting: bool(formData, "is_accepting"),
      is_archived: bool(formData, "is_archived"),
    } as TableUpdate<"teacher_profiles">)
    .eq("teacher_id", teacherId);

  if (error) {
    logError("admin updateTeacherProfile failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId } });
    return { error: "فشل حفظ بيانات المعلم" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

// ─── Ijazas ────────────────────────────────────────────────────────────

export async function upsertIjaza(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const id = str(formData, "id");
  const riwaya = str(formData, "riwaya");
  const chainText = str(formData, "chain_text");
  const grantedBy = str(formData, "granted_by");
  const grantedAt = str(formData, "granted_at");
  const documentUrl = str(formData, "document_url");

  if (!riwaya) return { error: "الرواية مطلوبة" };
  if (!chainText) return { error: "سند الإجازة مطلوب" };

  const supabase = await createClient();

  if (id) {
    const { error } = await supabase
      .from("teacher_ijaza")
      .update({
        riwaya,
        chain_text: chainText,
        granted_by: grantedBy,
        granted_at: grantedAt,
        document_url: documentUrl,
      } satisfies TableUpdate<"teacher_ijaza">)
      .eq("id", id)
      .eq("teacher_id", teacherId);
    if (error) {
      logError("admin upsertIjaza update failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, ijazaId: id } });
      return { error: "فشل تحديث الإجازة" };
    }
  } else {
    const { error } = await supabase.from("teacher_ijaza").insert({
      teacher_id: teacherId,
      riwaya,
      chain_text: chainText,
      granted_by: grantedBy,
      granted_at: grantedAt,
      document_url: documentUrl,
    } satisfies TableInsert<"teacher_ijaza">);
    if (error) {
      logError("admin upsertIjaza insert failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId } });
      return { error: "فشل إضافة الإجازة" };
    }
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function deleteIjaza(teacherId: string, ijazaId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teacher_ijaza")
    .delete()
    .eq("id", ijazaId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin deleteIjaza failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, ijazaId } });
    return { error: "فشل حذف الإجازة" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function setIjazaVerified(
  teacherId: string,
  ijazaId: string,
  verified: boolean,
): Promise<ActionResult> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teacher_ijaza")
    .update({
      verified_by: verified ? admin.id : null,
      verified_at: verified ? new Date().toISOString() : null,
    } satisfies TableUpdate<"teacher_ijaza">)
    .eq("id", ijazaId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin setIjazaVerified failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, ijazaId, verified } });
    return { error: "فشل تحديث حالة التوثيق" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

// ─── Availability ──────────────────────────────────────────────────────

export async function upsertAvailability(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const id = str(formData, "id");
  const day = num(formData, "day_of_week");
  const startTime = str(formData, "start_time");
  const endTime = str(formData, "end_time");
  const slotDuration = num(formData, "slot_duration") ?? 60;
  const isActive = bool(formData, "is_active");

  if (day === null || day < 0 || day > 6) return { error: "اليوم غير صحيح" };
  if (!startTime || !endTime) return { error: "الوقت مطلوب" };
  if (startTime >= endTime) return { error: "وقت البداية يجب أن يسبق وقت النهاية" };
  if (![30, 45, 60].includes(slotDuration)) return { error: "مدة الفترة غير صحيحة" };

  const supabase = await createClient();

  if (id) {
    const { error } = await supabase
      .from("teacher_availability")
      .update({
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
        slot_duration: slotDuration,
        is_active: isActive,
      } satisfies TableUpdate<"teacher_availability">)
      .eq("id", id)
      .eq("teacher_id", teacherId);
    if (error) {
      logError("admin upsertAvailability update failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, slotId: id } });
      return { error: "فشل تحديث التوفر" };
    }
  } else {
    const { error } = await supabase.from("teacher_availability").insert({
      teacher_id: teacherId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      slot_duration: slotDuration,
      is_active: isActive,
    } satisfies TableInsert<"teacher_availability">);
    if (error) {
      logError("admin upsertAvailability insert failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, day, startTime, endTime } });
      return { error: error.message.includes("avail_unique") ? "يوجد فترة في نفس اليوم والوقت" : "فشل إضافة التوفر" };
    }
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function deleteAvailability(teacherId: string, slotId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teacher_availability")
    .delete()
    .eq("id", slotId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin deleteAvailability failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, slotId } });
    return { error: "فشل حذف الفترة" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

// ─── Availability exceptions ───────────────────────────────────────────

export async function upsertException(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const date = str(formData, "date");
  if (!date) return { error: "التاريخ مطلوب" };

  const supabase = await createClient();
  const { error } = await supabase.from("availability_exceptions").insert({
    teacher_id: teacherId,
    date,
    start_time: str(formData, "start_time"),
    end_time: str(formData, "end_time"),
    is_blocked: bool(formData, "is_blocked"),
    reason: str(formData, "reason"),
  } satisfies TableInsert<"availability_exceptions">);
  if (error) {
    logError("admin upsertException failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, date } });
    return { error: "فشل إضافة الاستثناء" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function deleteException(teacherId: string, exceptionId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", exceptionId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin deleteException failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, exceptionId } });
    return { error: "فشل حذف الاستثناء" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

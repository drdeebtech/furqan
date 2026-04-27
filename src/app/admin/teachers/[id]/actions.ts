"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";

export type ActionResult = { error?: string; success?: boolean; notice?: string };

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

function revalidateTeacher(teacherId: string) {
  revalidatePath(`/admin/teachers/${teacherId}`);
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
    } as never)
    .eq("id", teacherId);

  if (error) return { error: "فشل حفظ بيانات الحساب" };

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
    } as never)
    .eq("teacher_id", teacherId);

  if (error) return { error: "فشل حفظ بيانات المعلم" };

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
      } as never)
      .eq("id", id)
      .eq("teacher_id", teacherId);
    if (error) return { error: "فشل تحديث الإجازة" };
  } else {
    const { error } = await supabase.from("teacher_ijaza").insert({
      teacher_id: teacherId,
      riwaya,
      chain_text: chainText,
      granted_by: grantedBy,
      granted_at: grantedAt,
      document_url: documentUrl,
    } as never);
    if (error) return { error: "فشل إضافة الإجازة" };
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
  if (error) return { error: "فشل حذف الإجازة" };

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
    } as never)
    .eq("id", ijazaId)
    .eq("teacher_id", teacherId);
  if (error) return { error: "فشل تحديث حالة التوثيق" };

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
      } as never)
      .eq("id", id)
      .eq("teacher_id", teacherId);
    if (error) return { error: "فشل تحديث التوفر" };
  } else {
    const { error } = await supabase.from("teacher_availability").insert({
      teacher_id: teacherId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      slot_duration: slotDuration,
      is_active: isActive,
    } as never);
    if (error) return { error: error.message.includes("avail_unique") ? "يوجد فترة في نفس اليوم والوقت" : "فشل إضافة التوفر" };
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
  if (error) return { error: "فشل حذف الفترة" };

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
  } as never);
  if (error) return { error: "فشل إضافة الاستثناء" };

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
  if (error) return { error: "فشل حذف الاستثناء" };

  revalidateTeacher(teacherId);
  return { success: true };
}

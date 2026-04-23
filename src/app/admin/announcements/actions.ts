"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnnouncementSeverity } from "@/types/database";

export interface AnnouncementResult {
  success?: string;
  error?: string;
  id?: string;
}

async function requireAdmin(): Promise<{ userId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };
  return { userId: user.id };
}

interface AnnouncementFields {
  message_ar: string;
  message_en: string;
  severity: AnnouncementSeverity;
  is_dismissible: boolean;
  active_from: string;
  active_until: string | null;
  cta_label_ar: string | null;
  cta_label_en: string | null;
  cta_href: string | null;
}

function parseForm(formData: FormData): { data?: AnnouncementFields; error?: string } {
  const message_ar = String(formData.get("message_ar") ?? "").trim();
  const message_en = String(formData.get("message_en") ?? "").trim();
  const severity = String(formData.get("severity") ?? "info") as AnnouncementSeverity;
  const is_dismissible = formData.get("is_dismissible") === "on";
  const active_from_raw = String(formData.get("active_from") ?? "").trim();
  const active_until_raw = String(formData.get("active_until") ?? "").trim();
  const cta_label_ar = String(formData.get("cta_label_ar") ?? "").trim() || null;
  const cta_label_en = String(formData.get("cta_label_en") ?? "").trim() || null;
  const cta_href = String(formData.get("cta_href") ?? "").trim() || null;

  if (!message_ar) return { error: "النص العربي مطلوب" };
  if (!message_en) return { error: "النص الإنجليزي مطلوب" };
  if (!["info", "warning", "critical"].includes(severity)) {
    return { error: "درجة التنبيه غير صحيحة" };
  }
  if (!active_from_raw) return { error: "تاريخ البدء مطلوب" };

  const ctaFieldsSet = [cta_label_ar, cta_label_en, cta_href].filter(Boolean).length;
  if (ctaFieldsSet > 0 && ctaFieldsSet < 3) {
    return { error: "إذا أدخلت رابط CTA فأدخل كل الحقول الثلاثة" };
  }

  const active_from = new Date(active_from_raw).toISOString();
  const active_until = active_until_raw ? new Date(active_until_raw).toISOString() : null;

  if (active_until && new Date(active_until) <= new Date(active_from)) {
    return { error: "تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء" };
  }

  return {
    data: {
      message_ar,
      message_en,
      severity,
      is_dismissible,
      active_from,
      active_until,
      cta_label_ar,
      cta_label_en,
      cta_href,
    },
  };
}

export async function createAnnouncement(
  _prev: AnnouncementResult,
  formData: FormData,
): Promise<AnnouncementResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const parsed = parseForm(formData);
  if (parsed.error) return { error: parsed.error };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_announcements")
    .insert({ ...parsed.data!, created_by: auth.userId } as never)
    .select("id")
    .returns<{ id: string }[]>()
    .single();

  if (error) return { error: "تعذر إنشاء التنبيه: " + error.message };

  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: "تم إنشاء التنبيه", id: data?.id };
}

export async function updateAnnouncement(
  id: string,
  _prev: AnnouncementResult,
  formData: FormData,
): Promise<AnnouncementResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const parsed = parseForm(formData);
  if (parsed.error) return { error: parsed.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("site_announcements")
    .update(parsed.data! as never)
    .eq("id", id);

  if (error) return { error: "تعذر تحديث التنبيه" };

  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: "تم حفظ التنبيه" };
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();
  const { error } = await admin.from("site_announcements").delete().eq("id", id);
  if (error) return { error: "تعذر الحذف" };

  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: "تم الحذف" };
}

export async function deactivateAnnouncement(id: string): Promise<AnnouncementResult> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("site_announcements")
    .update({ active_until: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { error: "تعذر الإيقاف" };

  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: "تم إيقاف التنبيه" };
}

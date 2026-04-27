"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loudAction, type LoudResult } from "@/lib/actions/loud";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface PersonalInfoInput {
  userId: string;
  fullName: string | null;
  fullNameAr: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  lang: string | null;
  dateOfBirth: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
}

const updatePersonalInfoBase = loudAction<PersonalInfoInput, { message?: string }>({
  name: "student.settings.update-personal-info",
  severity: "info",
  audit: {
    table: "profiles",
    recordId: (i) => i.userId,
    action: "UPDATE",
    reasonPrefix: "student self-update (personal + parent info)",
  },
  handler: async (input) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: input.fullName,
        full_name_ar: input.fullNameAr,
        phone: input.phone,
        country: input.country,
        timezone: input.timezone,
        lang: input.lang,
        date_of_birth: input.dateOfBirth,
        parent_name: input.parentName,
        parent_phone: input.parentPhone,
        parent_email: input.parentEmail,
      } as never)
      .eq("id", input.userId);
    if (error) throw error;

    revalidatePath("/student/settings");
    revalidatePath("/student/dashboard");
    return { message: "تم حفظ البيانات بنجاح" };
  },
});

export async function updatePersonalInfo(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح" };

  return updatePersonalInfoBase({
    userId: user.id,
    fullName: str(formData, "full_name"),
    fullNameAr: str(formData, "full_name_ar"),
    phone: str(formData, "phone"),
    country: str(formData, "country"),
    timezone: str(formData, "timezone"),
    lang: str(formData, "lang"),
    dateOfBirth: str(formData, "date_of_birth"),
    parentName: str(formData, "parent_name"),
    parentPhone: str(formData, "parent_phone"),
    parentEmail: str(formData, "parent_email"),
  });
}

export async function updatePassword(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "غير مصرح" };

  const currentPassword = formData.get("current_password");
  const newPassword = formData.get("new_password");
  const confirmPassword = formData.get("confirm_password");

  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { ok: false, error: "جميع الحقول مطلوبة" };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "كلمتا المرور غير متطابقتين" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" };
  }

  const adminClient = createAdminClient();
  const { error: verifyErr } = await adminClient.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) {
    return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) {
    return { ok: false, error: "فشل تحديث كلمة المرور — حاول مرة أخرى" };
  }

  return { ok: true, message: "تم تحديث كلمة المرور بنجاح" };
}

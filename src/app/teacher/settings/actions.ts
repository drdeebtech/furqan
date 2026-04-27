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

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
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
}

const updatePersonalInfoBase = loudAction<PersonalInfoInput, { message?: string }>({
  name: "teacher.settings.update-personal-info",
  severity: "info",
  audit: {
    table: "profiles",
    recordId: (i) => i.userId,
    action: "UPDATE",
    reasonPrefix: "teacher self-update (personal info)",
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
      } as never)
      .eq("id", input.userId);
    if (error) throw error;

    revalidatePath("/teacher/settings");
    revalidatePath("/teacher/dashboard");
    revalidatePath("/teachers-page");
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
  });
}

interface TeachingStatusInput {
  userId: string;
  isAccepting: boolean;
}

const updateTeachingStatusBase = loudAction<TeachingStatusInput, { message?: string }>({
  name: "teacher.settings.update-teaching-status",
  severity: "info",
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.userId,
    action: "UPDATE",
    reasonPrefix: "teacher self-update (teaching status)",
  },
  handler: async (input) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({ is_accepting: input.isAccepting } as never)
      .eq("teacher_id", input.userId);
    if (error) throw error;

    revalidatePath("/teacher/settings");
    revalidatePath("/teacher/dashboard");
    revalidatePath("/admin/teachers");
    revalidatePath("/teachers-page");
    return {
      message: input.isAccepting
        ? "أنت تقبل طلابًا جددًا الآن"
        : "تم إيقاف قبول طلاب جدد مؤقتًا",
    };
  },
});

export async function updateTeachingStatus(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح" };

  return updateTeachingStatusBase({
    userId: user.id,
    isAccepting: bool(formData, "is_accepting"),
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

  // Verify the current password by attempting a sign-in. We use the admin
  // client so this verification doesn't disturb the user's existing session
  // cookies (regular client would refresh tokens).
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

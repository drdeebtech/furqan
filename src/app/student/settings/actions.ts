"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { emitEvent } from "@/lib/automation/emit";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

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
      } as TableUpdate<"profiles">)
      .eq("id", input.userId);
    if (error) throw error;

    void emitEvent("profile.updated", "profile", input.userId, { updated_fields: Object.keys(input).filter((k) => k !== "userId") }, input.userId);
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

// updatePassword extracted to src/lib/actions/account.ts as a shared action
// — re-exported via @/components/shared/password-change-form.tsx so each
// role's settings page just drops in <PasswordChangeForm />.

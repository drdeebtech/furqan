"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Conservative shape validation — bounds only, no opinionated format rules
// (e.g. no phone-format regex, no country-code restriction). The goal is
// defense in depth against malformed FormData, not user-experience policy.
const personalInfoSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().min(1).max(200).nullable(),
  fullNameAr: z.string().min(1).max(200).nullable(),
  phone: z.string().min(3).max(30).nullable(),
  country: z.string().min(2).max(100).nullable(),
  timezone: z.string().min(1).max(100).nullable(),
  lang: z.string().min(2).max(10).nullable(),
  // ISO date (YYYY-MM-DD) without forcing strict parsing — Postgres rejects
  // bad dates downstream, this just keeps obvious garbage out.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const updatePersonalInfoBase = loudAction<z.infer<typeof personalInfoSchema>, { message?: string }>({
  name: "admin.account.update-personal-info",
  severity: "info",
  schema: personalInfoSchema,
  audit: {
    table: "profiles",
    recordId: (i) => i.userId,
    action: "UPDATE",
    reasonPrefix: "admin self-update (personal info)",
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

    revalidatePath("/admin/account");
    revalidatePath("/admin/dashboard");
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

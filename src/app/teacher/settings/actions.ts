"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

// Role-gated preflight for teacher self-service actions. Returns the
// actorId so loudAction stamps changed_by in the audit_log — without this
// preflight, actorId is null and the audit trail loses the actor identity.
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
    // actorId is set by preflight — the teacher is always updating their own row.
    recordId: (_i, actorId) => actorId ?? "unknown",
    action: "UPDATE",
    reasonPrefix: "teacher self-update (personal info)",
  },
  // preflight stamps actorId in the audit_log changed_by column.
  preflight: requireTeacherActor,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: input.fullName,
        full_name_ar: input.fullNameAr,
        phone: input.phone,
        country: input.country,
        // timezone and lang are non-nullable in the DB schema (string, not
        // string | null). Convert null → undefined so the field is omitted
        // from the UPDATE rather than attempting an illegal null assignment.
        timezone: input.timezone ?? undefined,
        lang: input.lang ?? undefined,
        date_of_birth: input.dateOfBirth,
      } satisfies TableUpdate<"profiles">)
      .eq("id", actorId as string);
    if (error) throw error;

    revalidatePath("/teacher/settings");
    revalidatePath("/teacher/dashboard");
    revalidatePath("/teachers");
    return { message: "تم حفظ البيانات بنجاح" };
  },
});

export async function updatePersonalInfo(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  return updatePersonalInfoBase({
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
  isAccepting: boolean;
}

const updateTeachingStatusBase = loudAction<TeachingStatusInput, { message?: string }>({
  name: "teacher.settings.update-teaching-status",
  severity: "info",
  audit: {
    table: "teacher_profiles",
    recordId: (_i, actorId) => actorId ?? "unknown",
    action: "UPDATE",
    reasonPrefix: "teacher self-update (teaching status)",
  },
  preflight: requireTeacherActor,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({ is_accepting: input.isAccepting })
      .eq("teacher_id", actorId as string);
    if (error) throw error;

    revalidatePath("/teacher/settings");
    revalidatePath("/teacher/dashboard");
    revalidatePath("/admin/teachers");
    revalidatePath("/teachers");

    emitEvent("teacher.status_updated", "teacher_profile", actorId as string, { is_accepting: input.isAccepting }, actorId as string)
      .catch((err) => logError("updateTeachingStatus emitEvent failed", err, { tag: "teacher-settings" }));

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
  return updateTeachingStatusBase({
    isAccepting: bool(formData, "is_accepting"),
  });
}

// updatePassword extracted to src/lib/actions/account.ts as a shared action
// — re-exported via @/components/shared/password-change-form.tsx so each
// role's settings page just drops in <PasswordChangeForm />.

"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import { sendTeacherWelcome } from "@/lib/email";
import { logError } from "@/lib/logger";
import type { CvStatus } from "@/types/database";

const MAX_APPLICATIONS_PER_HOUR = 3;
const VALID_LANGUAGES = new Set(["ar", "en", "ur", "fr", "tr", "id", "ms"]);
const VALID_RECITATIONS = new Set(["hafs", "warsh", "qalon", "al_duri", "shu_ba"]);
const VALID_SPECIALTIES = new Set([
  "tajweed",
  "memorization",
  "qiraat",
  "ijazah",
  "tafsir",
  "arabic",
  "kids",
]);

export type ApplyResult = {
  error?: string;
  success?: string;
};

async function checkApplyRate(ipKey: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_name", "teach-apply-attempt")
      .eq("entity_id", ipKey)
      .gte("started_at", oneHourAgo);

    if ((count ?? 0) >= MAX_APPLICATIONS_PER_HOUR) return false;

    const now = new Date().toISOString();
    await supabase.from("automation_logs").insert({
      workflow_name: "teach-apply-attempt",
      entity_type: "ip",
      entity_id: ipKey,
      status: "succeeded",
      started_at: now,
      finished_at: now,
    } as never);
    return true;
  } catch (err) {
    // Fail open — never block a real applicant because rate-limit table is down
    logError("teach-apply rate check failed — allowing", err, { tag: "teach-apply" });
    return true;
  }
}

export async function submitTeacherApplication(
  _prev: ApplyResult,
  formData: FormData,
): Promise<ApplyResult> {
  const verification = await checkBotId();
  if (verification.isBot) {
    return { error: "تعذر التحقق من الطلب" };
  }

  const full_name = ((formData.get("full_name") as string) || "").trim();
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  const phone = ((formData.get("phone") as string) || "").trim();
  const country = ((formData.get("country") as string) || "").trim();
  const gender = (formData.get("gender") as string) || "";
  const years_experience = parseInt(
    (formData.get("years_experience") as string) || "0",
    10,
  );
  const bio = ((formData.get("bio") as string) || "").trim();
  const intro_video_url = ((formData.get("intro_video_url") as string) || "").trim();
  const languages = formData.getAll("languages").map(String).filter(Boolean);
  const recitation_standards = formData
    .getAll("recitation_standards")
    .map(String)
    .filter(Boolean);
  const specialties = formData.getAll("specialties").map(String).filter(Boolean);

  if (!full_name || !email || !phone || !country || !bio) {
    return { error: "يرجى ملء جميع الحقول المطلوبة" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "البريد الإلكتروني غير صالح" };
  }
  if (full_name.length < 3 || full_name.length > 120) {
    return { error: "الاسم يجب أن يكون بين 3 و 120 حرفاً" };
  }
  if (bio.length < 40 || bio.length > 2000) {
    return { error: "النبذة الشخصية يجب أن تكون بين 40 و 2000 حرف" };
  }
  if (gender && gender !== "male" && gender !== "female") {
    return { error: "قيمة الجنس غير صالحة" };
  }
  if (languages.length === 0 || !languages.every((l) => VALID_LANGUAGES.has(l))) {
    return { error: "اختر لغة تدريس واحدة على الأقل" };
  }
  if (
    recitation_standards.length === 0 ||
    !recitation_standards.every((r) => VALID_RECITATIONS.has(r))
  ) {
    return { error: "اختر رواية واحدة على الأقل" };
  }
  if (specialties.length === 0 || !specialties.every((s) => VALID_SPECIALTIES.has(s))) {
    return { error: "اختر تخصصاً واحداً على الأقل" };
  }
  if (intro_video_url && !/^https?:\/\//.test(intro_video_url)) {
    return { error: "رابط الفيديو يجب أن يبدأ بـ https://" };
  }

  const hdrs = await headers();
  const ipKey =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown";

  if (!(await checkApplyRate(ipKey))) {
    return { error: "تم تجاوز عدد المحاولات المسموحة — حاول خلال ساعة" };
  }

  const adminClient = createAdminClient();

  const tempPassword = randomBytes(32).toString("hex");
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError || !authData?.user) {
    if (authError?.message?.includes("already been registered")) {
      // Soft response — no enumeration of existing accounts
      return {
        success:
          "إذا كان هذا البريد مسجلاً مسبقاً فستصلك رسالة لتأكيد الطلب. وإلا فتحقق من بريدك الوارد قريباً.",
      };
    }
    logError("teach-apply createUser failed", authError, { tag: "teach-apply" });
    return { error: "تعذّر إنشاء الحساب — حاول لاحقاً" };
  }

  const teacherId = authData.user.id;

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      role: "teacher",
      full_name,
      phone,
      country,
    } as never)
    .eq("id", teacherId);
  if (profileError) {
    logError("teach-apply profile update failed", profileError, { tag: "teach-apply" });
    return { error: "تم إنشاء الحساب لكن فشل تحديث الملف — راسل الدعم" };
  }

  const cv_status: CvStatus = "pending_review";
  const { error: tpError } = await adminClient.from("teacher_profiles").insert({
    teacher_id: teacherId,
    bio,
    bio_en: bio,
    specialties,
    recitation_standards,
    languages,
    hourly_rate: 20,
    gender: gender || null,
    intro_video_url: intro_video_url || null,
    cv_status,
    cv_submitted_at: new Date().toISOString(),
  } as never);
  if (tpError) {
    logError("teach-apply teacher_profile insert failed", tpError, { tag: "teach-apply" });
    return { error: "تم إنشاء الحساب لكن فشل حفظ بيانات المعلم — راسل الدعم" };
  }

  let magicLink: string | null = null;
  try {
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    magicLink = linkData?.properties?.action_link ?? null;
  } catch (err) {
    logError("teach-apply generateLink failed", err, { tag: "teach-apply" });
  }

  if (magicLink) {
    await sendTeacherWelcome({ to: email, fullName: full_name, magicLink, yearsExperience: years_experience }).catch(
      (err) => logError("teach-apply welcome email failed", err, { tag: "teach-apply" }),
    );
  }

  await emitEvent(
    "teacher.applied",
    "teacher_profile",
    teacherId,
    { email, full_name, country, languages, recitation_standards, specialties, years_experience },
    null,
  ).catch((err) => logError("teach-apply emitEvent failed", err, { tag: "teach-apply" }));

  await adminClient.from("audit_log").insert({
    changed_by: teacherId,
    table_name: "teacher_profiles",
    record_id: teacherId,
    action: "INSERT",
    old_data: null,
    new_data: { email, full_name, source: "teach-apply" },
    reason: "Teacher self-applied via /teach/apply",
  } as never);

  return {
    success:
      "تم استلام طلبك بنجاح. تحقق من بريدك الإلكتروني — أرسلنا لك رابط دخول مباشر للوحة المعلم.",
  };
}

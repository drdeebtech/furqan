"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import { sendTeacherWelcome, sendAdminTeacherApplicationAlert } from "@/lib/email";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import type { CvStatus } from "@/types/database";

const MAX_APPLICATIONS_PER_HOUR = 3;
const VALID_LANGUAGES = new Set(["ar", "en", "ur", "fr", "tr", "id", "ms"]);
const VALID_RECITATIONS = new Set([
  "hafs",
  "shu_ba",
  "warsh",
  "qalon",
  "al_duri_basri",
  "al_susi",
  "hisham",
  "ibn_dhakwan",
  "al_bazzi",
  "qunbul",
  "khalaf_hamzah",
  "khallad",
]);
const VALID_SPECIALTIES = new Set([
  "tajweed",
  "memorization",
  "murajaa",
  "qiraat",
  "ijazah",
  "tafsir",
  "arabic",
  "quranic_arabic",
  "kids",
  "adult_beginners",
  "reverts",
  "women_only",
  "salah_correction",
  "dua_adhkar",
  "aqeedah",
  "fiqh",
  "hadith",
  "sirah",
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
    });
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
  // Fail-closed: ambiguous BotID verdicts are treated as bot. Matches the
  // contact-form pattern; previous `verification.isBot` only blocked confident
  // verdicts, allowing partial-failure or novel-automation requests through.
  if (!verification.isHuman) {
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

  // Optional photo upload — best-effort, never blocks the application.
  const photoFile = formData.get("photo");
  if (photoFile instanceof File && photoFile.size > 0) {
    const okType = ["image/jpeg", "image/png", "image/webp"].includes(photoFile.type);
    const okSize = photoFile.size <= 2 * 1024 * 1024;
    if (okType && okSize) {
      try {
        const ext = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
        const path = `${teacherId}/${Date.now()}.${ext}`;
        const { error: upErr } = await adminClient.storage
          .from("teacher-avatars")
          .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
        if (upErr) {
          logError("teach-apply photo upload failed", upErr, { tag: "teach-apply" });
        } else {
          const { data: pub } = adminClient.storage.from("teacher-avatars").getPublicUrl(path);
          const avatarUrl = pub?.publicUrl ?? null;
          if (avatarUrl) {
            await adminClient
              .from("profiles")
              .update({ avatar_url: avatarUrl } as never)
              .eq("id", teacherId);
          }
        }
      } catch (err) {
        logError("teach-apply photo flow crashed", err, { tag: "teach-apply" });
      }
    }
  }

  const cv_status: CvStatus = "pending_review";
  // bio_en exists in TS types but not in the live Postgres schema — sending it
  // makes the insert fail. Single bio field; admin can localise later if needed.
  const { error: tpError } = await adminClient.from("teacher_profiles").insert({
    teacher_id: teacherId,
    bio,
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

  // Multi-channel admin notification — fire-and-forget, never block the user.
  // TODO: WhatsApp once cloud API token is configured.
  await Promise.allSettled([
    // 1. In-app bell for every admin
    (async () => {
      const { data: admins } = await adminClient
        .from("profiles")
        .select("id")
        .eq("role", "admin")
        .returns<{ id: string }[]>();
      const body = `${full_name} (${country}) — ${specialties.slice(0, 3).join(", ")}`;
      await Promise.allSettled(
        (admins ?? []).map((a) =>
          notify({
            userId: a.id,
            type: "system",
            title: "طلب تدريس جديد",
            body,
            entityType: "teacher_profile",
            entityId: teacherId,
          }),
        ),
      );
    })().catch((err) => logError("teach-apply in-app notify failed", err, { tag: "teach-apply" })),

    // 2. Email to ADMIN_EMAIL
    sendAdminTeacherApplicationAlert({
      fullName: full_name,
      email,
      phone,
      country,
      languages,
      recitations: recitation_standards,
      specialties,
      yearsExperience: years_experience,
      teacherId,
    }).catch((err) => logError("teach-apply admin email failed", err, { tag: "teach-apply" })),

    // 3. Telegram alert
    sendTelegramAlert(
      `🆕 <b>New teacher application</b>\n\n` +
        `<b>Name:</b> ${full_name}\n` +
        `<b>Country:</b> ${country}\n` +
        `<b>Email:</b> ${email}\n` +
        `<b>Phone:</b> ${phone}\n` +
        `<b>Specialties:</b> ${specialties.join(", ")}\n\n` +
        `<a href="https://www.furqan.today/admin/teachers/cv/${teacherId}">Review →</a>`,
    ).catch((err) => logError("teach-apply telegram failed", err, { tag: "teach-apply" })),
  ]);

  await adminClient.from("audit_log").insert({
    changed_by: teacherId,
    table_name: "teacher_profiles",
    record_id: teacherId,
    action: "INSERT",
    old_data: null,
    new_data: { email, full_name, source: "teach-apply" },
    reason: "Teacher self-applied via /teach-with-us/apply",
  } as never);

  return {
    success:
      "تم استلام طلبك بنجاح. تحقق من بريدك الإلكتروني — أرسلنا لك رابط دخول مباشر للوحة المعلم.",
  };
}

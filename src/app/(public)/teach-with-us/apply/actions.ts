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
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

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
    // `automation_logs.entity_id` is a UUID column. Storing the raw IP
    // string there caused Postgres 22P02 (`invalid input syntax for type
    // uuid`) on every apply, which surfaced as JAVASCRIPT-NEXTJS-E4-25,
    // E4-26, E4-29 in Sentry. Move the IP into `payload_json` (jsonb) and
    // leave `entity_id` NULL — the IP is rate-limit metadata, not a domain
    // entity. Query/insert pivot to `payload_json->>ip`.
    const { count } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_name", "teach-apply-attempt")
      .eq("payload_json->>ip", ipKey)
      .gte("started_at", oneHourAgo);

    if ((count ?? 0) >= MAX_APPLICATIONS_PER_HOUR) return false;

    const now = new Date().toISOString();
    await supabase.from("automation_logs").insert({
      workflow_name: "teach-apply-attempt",
      entity_type: "ip",
      entity_id: null,
      payload_json: { ip: ipKey },
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

  // Both `role` (scalar) AND `roles[]` (array) must transition together to
  // satisfy `profiles_active_role_in_set` CHECK constraint (`role = ANY(roles)`,
  // see migration 20260501173121). Schema default for `roles` is `['student']`
  // (migration 20260506083602) — leaving it would make the CHECK fail and
  // Postgres reject the UPDATE. The prior code updated only the scalar `role`,
  // every applicant hit the constraint violation, the function exited early
  // at this guard, and no admin notification ever fired. Operator audit
  // 2026-05-09: confirmed via "sheikh anas" application that landed under
  // students.
  //
  // `.select("id")` exposes zero-rows-affected as a fail-loud signal
  // (CodeRabbit pattern from PR #271) — RLS denial would otherwise return
  // `error: null` + `data: []` and the wrap below would treat it as success.
  const { data: profileUpd, error: profileError } = await adminClient
    .from("profiles")
    .update({
      role: "teacher",
      roles: ["teacher"],
      full_name,
      phone,
      country,
    } as never)
    .eq("id", teacherId)
    .select("id");
  if (profileError || !profileUpd || profileUpd.length === 0) {
    logError("teach-apply profile update failed", profileError, {
      tag: "teach-apply",
      severity: "warning",
      metadata: { teacherId, rowsAffected: profileUpd?.length ?? 0 },
    });
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
              .update({ avatar_url: avatarUrl } satisfies TableUpdate<"profiles">)
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
    // Form input arrives as untyped string; the column is the gender_type
    // enum ('male' | 'female'). Narrowing cast documents the expected type
    // at the site (better than blanket `as never`).
    gender: (gender || null) as "male" | "female" | null,
    intro_video_url: intro_video_url || null,
    cv_status,
    cv_submitted_at: new Date().toISOString(),
  });
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
    // 1. In-app bell for every admin.
    //    Filter by `roles[] @> ['admin']` instead of `role = 'admin'` so
    //    multi-role admins (e.g. an admin currently viewing as teacher with
    //    role='teacher', roles=['admin','teacher']) still receive the alert.
    //    The `profiles_roles_gin` index from migration 20260501173121
    //    supports this filter cheaply.
    (async () => {
      const { data: admins } = await adminClient
        .from("profiles")
        .select("id")
        .contains("roles", ["admin"])
        .returns<{ id: string }[]>();
      // Empty-broadcast fail-loud: if zero admins matched, ops would never
      // see a new application again. Surface to Sentry + Telegram so the
      // missing-admins state shows up the first time it happens, not the
      // 50th. (Layer 4c per PR plan.)
      if (!admins || admins.length === 0) {
        logError(
          "teach-apply admin broadcast hit zero recipients",
          new Error("no profiles with roles @> ['admin'] — admin alert silently dropped"),
          { tag: "teach-apply", severity: "warning", metadata: { teacherId } },
        );
        sendTelegramAlert(
          `⚠️ <b>Teacher application received but NO admin recipients found</b>\n\n` +
            `<b>Applicant:</b> ${full_name}\n<b>Email:</b> ${email}\n` +
            `Investigate: <code>profiles WHERE 'admin' = ANY(roles)</code> returned 0 rows.`,
        ).catch((err) => logError("teach-apply zero-admin telegram fallback failed", err, { tag: "teach-apply" }));
        return;
      }
      const body = `${full_name} (${country}) — ${specialties.slice(0, 3).join(", ")}`;
      await Promise.allSettled(
        admins.map((a) =>
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
  });

  return {
    success:
      "تم استلام طلبك بنجاح. تحقق من بريدك الإلكتروني — أرسلنا لك رابط دخول مباشر للوحة المعلم.",
  };
}

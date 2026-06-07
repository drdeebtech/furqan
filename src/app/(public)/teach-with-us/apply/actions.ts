"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import { sendTeacherWelcome, sendAdminTeacherApplicationAlert } from "@/lib/email";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { notify } from "@/lib/notifications/dispatcher";
import { notifyNewTeacherApplication } from "@/lib/whatsapp";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import type { CvStatus } from "@/types/database";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

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

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

// User-facing success strings. The handler stashes one of the keys in
// loudAction's `message` slot; the public adapter remaps to the real text.
// This indirection lets the handler distinguish soft-existing-email
// (no enumeration; marketing-style ambiguous response) from a real new
// application — both are "success" but display different copy.
const SUCCESS_TEXT = {
  applied:
    "تم استلام طلبك بنجاح. تحقق من بريدك الإلكتروني — أرسلنا لك رابط دخول مباشر للوحة المعلم.",
  alreadyRegistered:
    "إذا كان هذا البريد مسجلاً مسبقاً فستصلك رسالة لتأكيد الطلب. وإلا فتحقق من بريدك الوارد قريباً.",
} as const;

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
    const { error: autoLogError } = await supabase.from("automation_logs").insert({
      workflow_name: "teach-apply-attempt",
      entity_type: "ip",
      entity_id: null,
      payload_json: { ip: ipKey },
      status: "succeeded",
      started_at: now,
      finished_at: now,
    });
    if (autoLogError) {
      logError("teach-apply rate-limit log insert failed", autoLogError, { tag: "teach-apply" });
    }
    return true;
  } catch (err) {
    // Fail open — never block a real applicant because rate-limit table is down
    logError("teach-apply rate check failed — allowing", err, { tag: "teach-apply" });
    return true;
  }
}

// ─── Wrapped DB-side handler (loudAction, severity=warning) ─────────────────

type ApplyInput = {
  full_name: string;
  email: string;
  phone: string;
  country: string;
  gender: string;
  years_experience: number;
  bio: string;
  intro_video_url: string;
  languages: string[];
  recitation_standards: string[];
  specialties: string[];
  ipKey: string;
  // Photo handed in raw — the handler does its own size/type guard. Wrapping
  // a Blob through useActionState would lose the File metadata, so we hand
  // the original File reference through.
  photo: File | null;
};

const submitTeacherApplicationBase = loudAction<ApplyInput, { message: string }>({
  name: "teach-apply.submit",
  // P0-adjacent: a real teacher application going missing is operationally
  // significant (would have surfaced "sheikh anas" the first time). Warning
  // routes to Sentry without paging Telegram on every routine application;
  // explicit Telegram still fires inside the handler for the new-applicant
  // alert.
  severity: "warning",
  audit: {
    table: "teacher_profiles",
    // recordId resolved post-create; the audit envelope row written by the
    // framework records the IP-based pseudo-id pre-create. The diff
    // `audit_log.insert` at the end of the handler carries the real
    // teacherId once auth.admin.createUser returns it.
    recordId: (i) => `pending:${i.email}`,
    action: "INSERT",
    reasonPrefix: "teacher self-applied",
  },
  // No preflight — apply is anonymous (no auth). actorId stays null.
  handler: async (input) => {
    if (!(await checkApplyRate(input.ipKey))) {
      throw new UserError("تم تجاوز عدد المحاولات المسموحة — حاول خلال ساعة");
    }

    const adminClient = createAdminClient();

    const tempPassword = randomBytes(32).toString("hex");
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });

    if (authError || !authData?.user) {
      if (authError?.message?.includes("already been registered")) {
        // Soft response — no enumeration of existing accounts.
        // NOT a system error; plain UserError-shape return via message.
        return { message: "alreadyRegistered" };
      }
      throw new UserError("تعذّر إنشاء الحساب — حاول لاحقاً", {
        cause: authError ?? new Error("createUser returned no user"),
      });
    }

    const teacherId = authData.user.id;

    // Both `role` (scalar) AND `roles[]` (array) must transition together to
    // satisfy `profiles_active_role_in_set` CHECK constraint. See the
    // companion fixes in admin/teachers/actions.ts and admin/users/actions.ts
    // (same root cause across all three role-mutating writers).
    const { data: profileUpd, error: profileError } = await adminClient
      .from("profiles")
      .update({
        role: "teacher",
        roles: ["teacher"],
        full_name: input.full_name,
        phone: input.phone,
        country: input.country,
      } as never)
      .eq("id", teacherId)
      .select("id");
    if (profileError || !profileUpd || profileUpd.length === 0) {
      throw new UserError("تم إنشاء الحساب لكن فشل تحديث الملف — راسل الدعم", {
        cause: profileError ?? new Error(`profile update affected 0 rows for teacherId=${teacherId}`),
      });
    }

    // Optional photo upload — best-effort, never blocks the application.
    if (input.photo && input.photo.size > 0) {
      const okType = ["image/jpeg", "image/png", "image/webp"].includes(input.photo.type);
      const okSize = input.photo.size <= 2 * 1024 * 1024;
      if (okType && okSize) {
        try {
          const ext = input.photo.type === "image/jpeg" ? "jpg" : input.photo.type.split("/")[1];
          const path = `${teacherId}/${Date.now()}.${ext}`;
          const { error: upErr } = await adminClient.storage
            .from("teacher-avatars")
            .upload(path, input.photo, { contentType: input.photo.type, upsert: false });
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
    //
    // UPSERT, not INSERT: the `t_ensure_teacher_profile` trigger (migration
    // 20260428095637) fires on the `profiles.role = 'teacher'` update above and
    // auto-creates a stub row (bio NULL, cv_status='approved', is_accepting=true)
    // before this write runs. A plain insert then dies on duplicate-key, the
    // applicant sees "فشل حفظ بيانات المعلم", their bio/specialties are lost —
    // AND they're left auto-approved with an empty profile. The upsert overwrites
    // the stub with the real application data and resets the review state.
    // (Found by E2E 2026-06-07; the trigger is correct for admin-created
    // teachers, so it stays — this writer adapts.)
    const { error: tpError } = await adminClient.from("teacher_profiles").upsert(
      {
        teacher_id: teacherId,
        bio: input.bio,
        specialties: input.specialties,
        recitation_standards: input.recitation_standards,
        languages: input.languages,
        hourly_rate: 20,
        gender: (input.gender || null) as "male" | "female" | null,
        intro_video_url: input.intro_video_url || null,
        cv_status,
        cv_submitted_at: new Date().toISOString(),
        // The trigger stub sets is_accepting=true; an unreviewed applicant must
        // not be bookable until an admin approves the CV.
        is_accepting: false,
      } satisfies TableInsert<"teacher_profiles">,
      { onConflict: "teacher_id" },
    );
    if (tpError) {
      throw new UserError("تم إنشاء الحساب لكن فشل حفظ بيانات المعلم — راسل الدعم", {
        cause: tpError,
      });
    }

    // The new pending application must show up in the admin review queue
    // without waiting for cache expiry (coding guideline: revalidate after
    // every mutation).
    revalidatePath("/admin/teachers");

    let magicLink: string | null = null;
    try {
      const { data: linkData } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: input.email,
      });
      magicLink = linkData?.properties?.action_link ?? null;
    } catch (err) {
      logError("teach-apply generateLink failed", err, { tag: "teach-apply" });
    }

    if (magicLink) {
      await sendTeacherWelcome({
        to: input.email,
        fullName: input.full_name,
        magicLink,
        yearsExperience: input.years_experience,
      }).catch((err) => logError("teach-apply welcome email failed", err, { tag: "teach-apply" }));
    }

    await emitEvent(
      "teacher.applied",
      "teacher_profile",
      teacherId,
      {
        email: input.email,
        full_name: input.full_name,
        country: input.country,
        languages: input.languages,
        recitation_standards: input.recitation_standards,
        specialties: input.specialties,
        years_experience: input.years_experience,
      },
      null,
    ).catch((err) => logError("teach-apply emitEvent failed", err, { tag: "teach-apply" }));

    // Multi-channel admin notification — fire-and-forget, never block the user.
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
        // 50th. (Layer 4c per /Users/drdeeb/.claude/plans/one-tacher-aplied-to-cozy-swan.md.)
        if (!admins || admins.length === 0) {
          logError(
            "teach-apply admin broadcast hit zero recipients",
            new Error("no profiles with roles @> ['admin'] — admin alert silently dropped"),
            { tag: "teach-apply", severity: "warning", metadata: { teacherId } },
          );
          sendTelegramAlert(
            `⚠️ <b>Teacher application received but NO admin recipients found</b>\n\n` +
              `<b>Applicant:</b> ${input.full_name}\n<b>Email:</b> ${input.email}\n` +
              `Investigate: <code>profiles WHERE 'admin' = ANY(roles)</code> returned 0 rows.`,
          ).catch((err) =>
            logError("teach-apply zero-admin telegram fallback failed", err, { tag: "teach-apply" }),
          );
          return;
        }
        const body = `${input.full_name} (${input.country}) — ${input.specialties.slice(0, 3).join(", ")}`;
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
        fullName: input.full_name,
        email: input.email,
        phone: input.phone,
        country: input.country,
        languages: input.languages,
        recitations: input.recitation_standards,
        specialties: input.specialties,
        yearsExperience: input.years_experience,
        teacherId,
      }).catch((err) => logError("teach-apply admin email failed", err, { tag: "teach-apply" })),

      // 3. Telegram alert
      sendTelegramAlert(
        `🆕 <b>New teacher application</b>\n\n` +
          `<b>Name:</b> ${input.full_name}\n` +
          `<b>Country:</b> ${input.country}\n` +
          `<b>Email:</b> ${input.email}\n` +
          `<b>Phone:</b> ${input.phone}\n` +
          `<b>Specialties:</b> ${input.specialties.join(", ")}\n\n` +
          `<a href="https://www.furqan.today/admin/teachers/cv/${teacherId}">Review →</a>`,
      ).catch((err) => logError("teach-apply telegram failed", err, { tag: "teach-apply" })),

      // 4. WhatsApp notification
      notifyNewTeacherApplication(
        input.full_name,
        input.country,
        input.specialties,
      ).catch((err) => logError("teach-apply whatsapp failed", err, { tag: "teach-apply" })),
    ]);

    // Diff audit row — preserved alongside the framework's generic envelope.
    // Carries the actual teacherId (the framework's recordId is a `pending:`
    // placeholder pre-create). Best-effort: a failed audit insert must NOT
    // fail the action itself, but it also must NOT be silently dropped.
    // Two-arg `.then(onFulfilled, onRejected)` because PostgrestBuilder
    // returns PromiseLike (no `.catch`) — same pattern as
    // src/lib/actions/group-session.ts addStudentToSession. (CodeRabbit
    // post-#274 review.)
    await adminClient
      .from("audit_log")
      .insert({
        changed_by: teacherId,
        table_name: "teacher_profiles",
        record_id: teacherId,
        action: "INSERT",
        old_data: null,
        new_data: { email: input.email, full_name: input.full_name, source: "teach-apply" },
        reason: "Teacher self-applied via /teach-with-us/apply",
      })
      .then(
        (r) => {
          if (r.error) {
            logError("teach-apply audit_log insert failed", r.error, {
              tag: "teach-apply",
              metadata: { teacherId },
            });
          }
        },
        (err: unknown) => {
          logError("teach-apply audit_log insert promise rejected", err, {
            tag: "teach-apply",
            metadata: { teacherId },
          });
        },
      );

    return { message: "applied" };
  },
});

// ─── Public wrapper ─────────────────────────────────────────────────────────

export async function submitTeacherApplication(
  _prev: ApplyResult,
  formData: FormData,
): Promise<ApplyResult> {
  // BotID + form parsing + validation OUTSIDE the loudAction wrap. These
  // are user-input checks, not system failures — wrapping them would route
  // every typo'd email into Sentry and the audit_log, which is noise.
  const verification = await checkBotId();
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

  const photoFile = formData.get("photo");
  const photo = photoFile instanceof File ? photoFile : null;

  const result = await submitTeacherApplicationBase({
    full_name,
    email,
    phone,
    country,
    gender,
    years_experience,
    bio,
    intro_video_url,
    languages,
    recitation_standards,
    specialties,
    ipKey,
    photo,
  });

  if (!result.ok) return { error: result.error };
  // result.message marks which success copy to render. Defaults to the
  // happy-path "applied" text for any unrecognised marker (defensive).
  if (result.message === "alreadyRegistered") {
    return { success: SUCCESS_TEXT.alreadyRegistered };
  }
  return { success: SUCCESS_TEXT.applied };
}

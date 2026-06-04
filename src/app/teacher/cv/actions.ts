"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";
import { emitEvent } from "@/lib/automation/emit";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

export type CvResult = {
  error?: string;
  success?: boolean;
};

// teacherPreflight verifies the caller is authenticated AND holds the
// teacher (or admin) role at the action layer — defense-in-depth on top of
// the edge middleware in proxy.ts. Any authenticated non-teacher (e.g. a
// student) would have been blocked by the middleware, but server actions are
// reachable without it in tests / direct POST, so the check belongs here too.
async function teacherPreflight(): Promise<{ actorId: string }> {
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

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type SaveCvInput = {
  bio: string;
  bio_en: string | null;
  specialties: string[];
  languages: string[];
  recitation_standards: string[];
  intro_video_url: string | null;
};

const saveCvDraftBase = loudAction<SaveCvInput, { message: string }>({
  name: "teacher.cv.save-draft",
  severity: "info",
  schema: z.object({
    bio: z.string(),
    bio_en: z.string().nullable(),
    specialties: z.array(z.string()),
    languages: z.array(z.string()),
    recitation_standards: z.array(z.string()),
    intro_video_url: z.string().nullable(),
  }),
  audit: {
    table: "teacher_profiles",
    recordId: (_i, actorId) => actorId ?? "unknown",
    action: "UPDATE",
    reasonPrefix: "teacher save CV draft",
  },
  preflight: teacherPreflight,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({
        bio: input.bio,
        bio_en: input.bio_en,
        specialties: input.specialties,
        languages: input.languages,
        recitation_standards: input.recitation_standards,
        intro_video_url: input.intro_video_url,
      })
      .eq("teacher_id", actorId as string);
    if (error) throw new UserError("فشل حفظ المسودة — يرجى المحاولة مرة أخرى", { cause: error });
    revalidatePath("/teacher/cv");
    return { message: "saved" };
  },
});

export async function saveCvDraft(
  _prev: CvResult,
  formData: FormData,
): Promise<CvResult> {
  // Form switched from comma-separated text to multi-checkbox — checkboxes
  // with the same `name` serialize as multiple values, so getAll() returns
  // the array directly.
  const result = await saveCvDraftBase({
    bio: (formData.get("bio") as string) || "",
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: (formData.getAll("specialties") as string[]).filter(Boolean),
    languages: (formData.getAll("languages") as string[]).filter(Boolean),
    recitation_standards: (formData.getAll("recitation_standards") as string[]).filter(Boolean),
    intro_video_url: (formData.get("intro_video_url") as string) || null,
  });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const submitCvForReviewBase = loudAction<Record<string, never>, { message: string }>({
  name: "teacher.cv.submit-for-review",
  severity: "warning",
  schema: z.object({}),
  audit: {
    table: "teacher_profiles",
    recordId: (_i, actorId) => actorId ?? "unknown",
    action: "UPDATE",
    reasonPrefix: "teacher submit CV for review",
  },
  preflight: teacherPreflight,
  handler: async (_input, { actorId }) => {
    const supabase = await createClient();
    const { data: updated, error } = await supabase
      .from("teacher_profiles")
      .update({
        cv_status: "pending_review",
        cv_submitted_at: new Date().toISOString(),
      })
      .eq("teacher_id", actorId as string)
      .select("teacher_id")
      .maybeSingle();

    if (error) throw new UserError("فشل إرسال السيرة الذاتية — يرجى المحاولة مرة أخرى", { cause: error });
    if (!updated) throw new UserError("فشل إرسال السيرة الذاتية — يرجى المحاولة مرة أخرى", {
      cause: new Error("no-rows-updated — RLS or missing teacher_profiles row"),
    });

    await emitEvent("teacher.cv_submitted", "teacher_profiles", actorId as string, {
      submitted_by: actorId,
    }).catch((err) =>
      logError("submitCvForReview: emitEvent teacher.cv_submitted failed", err, {
        tag: "teacher-cv",
        metadata: { teacherId: actorId },
      })
    );

    revalidatePath("/teacher/cv");
    return { message: "تم إرسال السيرة الذاتية للمراجعة" };
  },
});

export async function submitCvForReview(): Promise<CvResult> {
  const result = await submitCvForReviewBase({});
  if (!result.ok) return { error: result.error };
  return { success: true };
}

export async function saveProfilePhoto(
  _prev: CvResult,
  formData: FormData,
): Promise<CvResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Defense-in-depth role gate — server actions are reachable without
  // middleware, so verify the caller is a teacher/admin at the action layer.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (profileErr) {
    logError("saveProfilePhoto: profile lookup failed", profileErr, {
      component: "teacher.cv.saveProfilePhoto",
      metadata: { userId: user.id },
    });
    return { error: "تعذر التحقق من الصلاحية. حاول مجدداً." };
  }
  if (!profile || !["teacher", "admin"].includes(profile.role)) {
    return { error: "ليس لديك صلاحية" };
  }

  const photoFile = formData.get("photo");
  if (!(photoFile instanceof File) || photoFile.size === 0) {
    return { error: "يرجى اختيار صورة" };
  }
  if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
    return { error: "نوع الملف غير مدعوم — يرجى رفع JPG أو PNG أو WebP" };
  }
  if (photoFile.size > MAX_PHOTO_BYTES) {
    return { error: "الملف كبير جدًا — الحد الأقصى 2 ميغابايت" };
  }

  const adminClient = createAdminClient();
  const ext = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: upErr } = await adminClient.storage
    .from("teacher-avatars")
    .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
  if (upErr) {
    logError("teacher cv photo upload failed", upErr, { tag: "teacher-cv-photo" });
    return { error: "فشل رفع الصورة — يرجى المحاولة مرة أخرى" };
  }

  const { data: pub } = adminClient.storage.from("teacher-avatars").getPublicUrl(path);
  const avatarUrl = pub?.publicUrl ?? null;
  if (!avatarUrl) return { error: "تعذر إنشاء رابط الصورة — يرجى المحاولة مرة أخرى" };

  const { error: updErr } = await adminClient
    .from("profiles")
    .update({ avatar_url: avatarUrl } satisfies TableUpdate<"profiles">)
    .eq("id", user.id);
  if (updErr) {
    logError("teacher cv photo profile update failed", updErr, { tag: "teacher-cv-photo" });
    return { error: "تم رفع الصورة لكن فشل حفظها — يرجى المحاولة مرة أخرى" };
  }

  revalidatePath("/teacher/cv");
  revalidatePath("/teacher/dashboard");
  revalidatePath("/admin/teachers");
  revalidatePath(`/admin/teachers/${user.id}`);
  revalidatePath("/teachers");
  return { success: true };
}

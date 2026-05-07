"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export type CvResult = {
  error?: string;
  success?: boolean;
};

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function saveCvDraft(
  _prev: CvResult,
  formData: FormData,
): Promise<CvResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const bio = formData.get("bio") as string;
  const bio_en = (formData.get("bio_en") as string) || null;
  // Form switched from comma-separated text to multi-checkbox — checkboxes
  // with the same `name` serialize as multiple values, so getAll() returns
  // the array directly.
  const specialties = (formData.getAll("specialties") as string[]).filter(Boolean);
  const languages = (formData.getAll("languages") as string[]).filter(Boolean);
  const recitation_standards = (formData.getAll("recitation_standards") as string[]).filter(Boolean);
  const intro_video_url =
    (formData.get("intro_video_url") as string) || null;

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      bio,
      bio_en,
      specialties,
      languages,
      recitation_standards,
      intro_video_url,
    })
    .eq("teacher_id", user.id);

  if (error) {
    logError("teacher saveCvDraft failed", error, { tag: "teacher-cv", severity: "warning", metadata: { teacherId: user.id } });
    return { error: "فشل حفظ المسودة — يرجى المحاولة مرة أخرى" };
  }
  revalidatePath("/teacher/cv");
  return { success: true };
}

export async function submitCvForReview(): Promise<CvResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      cv_status: "pending_review",
      cv_submitted_at: new Date().toISOString(),
    })
    .eq("teacher_id", user.id);

  if (error) {
    logError("teacher submitCvForReview failed", error, { tag: "teacher-cv", severity: "warning", metadata: { teacherId: user.id } });
    return { error: "فشل إرسال السيرة الذاتية — يرجى المحاولة مرة أخرى" };
  }
  revalidatePath("/teacher/cv");
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
    .update({ avatar_url: avatarUrl } as never)
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

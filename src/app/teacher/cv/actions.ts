"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CvResult = {
  error?: string;
  success?: boolean;
};

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
    } as never)
    .eq("teacher_id", user.id);

  if (error) return { error: "فشل حفظ المسودة — يرجى المحاولة مرة أخرى" };
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
    } as never)
    .eq("teacher_id", user.id);

  if (error) return { error: "فشل إرسال السيرة الذاتية — يرجى المحاولة مرة أخرى" };
  revalidatePath("/teacher/cv");
  return { success: true };
}

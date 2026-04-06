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
  const specialties =
    (formData.get("specialties") as string)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const languages =
    (formData.get("languages") as string)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const recitation_standards =
    (formData.get("recitation_standards") as string)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const intro_video_url =
    (formData.get("intro_video_url") as string) || null;

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      bio,
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

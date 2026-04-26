"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export async function toggleReviewPublic(reviewId: string, isPublic: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };

  const { error } = await supabase.from("reviews").update({ is_public: isPublic } as never).eq("id", reviewId);
  if (error) {
    logError("admin.toggleReviewPublic failed", error, { tag: "admin-reviews" });
    return { error: `فشل التحديث: ${error.message}` };
  }
  revalidatePath("/admin/reviews");
  return { success: true };
}

export async function deleteReview(reviewId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };

  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) return { error: "فشل حذف المراجعة" };

  revalidatePath("/admin/reviews");
  return { success: true };
}

"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

async function guardAdmin(): Promise<{ error: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { error: e.message === "not authenticated" ? "غير مصرح" : "ليس لديك صلاحية" };
    }
    throw e;
  }
}

export async function toggleReviewPublic(reviewId: string, isPublic: boolean) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.from("reviews").update({ is_public: isPublic } as never).eq("id", reviewId);
  if (error) {
    logError("admin.toggleReviewPublic failed", error, { tag: "admin-reviews" });
    return { error: `فشل التحديث: ${error.message}` };
  }
  revalidatePath("/admin/reviews");
  return { success: true };
}

export async function deleteReview(reviewId: string) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) return { error: "فشل حذف المراجعة" };

  revalidatePath("/admin/reviews");
  return { success: true };
}

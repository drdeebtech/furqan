"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleReviewPublic(reviewId: string, isPublic: boolean) {
  const supabase = await createClient();
  await supabase.from("reviews").update({ is_public: isPublic } as never).eq("id", reviewId);
  revalidatePath("/admin/reviews");
  return { success: true };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routeAction } from "@/lib/actions/route-action";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

type ActionResult = { error?: string; success?: boolean };

const toggleReviewPublicBase = routeAction<{ reviewId: string; isPublic: boolean }, { message: string }>({
  name: "admin.reviews.toggle-public",
  role: "admin",
  severity: "warning",
  schema: z.object({ reviewId: z.string().uuid(), isPublic: z.boolean() }),
  audit: { table: "reviews", recordId: (i) => i.reviewId, action: "UPDATE" },
  handler: async ({ reviewId, isPublic }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("reviews")
      .update({ is_public: isPublic } satisfies TableUpdate<"reviews">)
      .eq("id", reviewId);
    if (error) throw error;

    revalidatePath("/admin/reviews");
    return { message: isPublic ? "تم نشر المراجعة" : "تم إخفاء المراجعة" };
  },
});

export async function toggleReviewPublic(reviewId: string, isPublic: boolean): Promise<ActionResult> {
  const result = await toggleReviewPublicBase({ reviewId, isPublic });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const deleteReviewBase = routeAction<{ reviewId: string }, { message: string }>({
  name: "admin.reviews.delete",
  role: "admin",
  severity: "warning",
  schema: z.object({ reviewId: z.string().uuid() }),
  audit: { table: "reviews", recordId: (i) => i.reviewId, action: "DELETE" },
  handler: async ({ reviewId }) => {
    const supabase = await createClient();
    const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
    if (error) throw error;

    revalidatePath("/admin/reviews");
    return { message: "تم حذف المراجعة" };
  },
});

export async function deleteReview(reviewId: string): Promise<ActionResult> {
  const result = await deleteReviewBase({ reviewId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

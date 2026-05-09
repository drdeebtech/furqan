"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
}

type ActionResult = { error?: string; success?: boolean };

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
    throw e;
  }
}

const toggleReviewPublicBase = loudAction<{ reviewId: string; isPublic: boolean }, { message: string }>({
  name: "admin.reviews.toggle-public",
  severity: "warning",
  schema: z.object({ reviewId: z.string().uuid(), isPublic: z.boolean() }),
  audit: { table: "reviews", recordId: (i) => i.reviewId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ reviewId, isPublic }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("reviews")
      .update({ is_public: isPublic } as never)
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

const deleteReviewBase = loudAction<{ reviewId: string }, { message: string }>({
  name: "admin.reviews.delete",
  severity: "warning",
  schema: z.object({ reviewId: z.string().uuid() }),
  audit: { table: "reviews", recordId: (i) => i.reviewId, action: "DELETE" },
  preflight: adminPreflight,
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

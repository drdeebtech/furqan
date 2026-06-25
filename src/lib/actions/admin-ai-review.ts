"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";

const ApproveSchema = z.object({
  id: z.string().uuid(),
});

const RejectSchema = z.object({
  id: z.string().uuid(),
  rejection_reason: z.string().min(1).max(500),
});

export async function approveReview(formData: FormData) {
  await requireAdmin();
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Unauthenticated");

  const { id } = ApproveSchema.parse({ id: formData.get("id") });

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("ai_output_review")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) throw new Error(error.message);
  revalidatePath("/admin/ai-review");
}

export async function rejectReview(formData: FormData) {
  await requireAdmin();
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Unauthenticated");

  const { id, rejection_reason } = RejectSchema.parse({
    id: formData.get("id"),
    rejection_reason: formData.get("rejection_reason"),
  });

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("ai_output_review")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason,
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) throw new Error(error.message);
  revalidatePath("/admin/ai-review");
}

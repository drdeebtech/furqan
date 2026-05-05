"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

export async function togglePolicyActive(policyId: string, isActive: boolean) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("refund_policies").update({ is_active: isActive } as never).eq("id", policyId);
  if (error) {
    logError("admin togglePolicyActive failed", error, { tag: "admin-refund-policies", severity: "warning", metadata: { policyId, isActive } });
    return { error: "تعذر تحديث السياسة" };
  }
  revalidatePath("/admin/refund-policies");
  return { success: true };
}

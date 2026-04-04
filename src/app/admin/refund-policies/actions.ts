"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function togglePolicyActive(policyId: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("refund_policies").update({ is_active: isActive } as never).eq("id", policyId);
  revalidatePath("/admin/refund-policies");
  return { success: true };
}

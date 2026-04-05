"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function togglePolicyActive(policyId: string, isActive: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };

  await supabase.from("refund_policies").update({ is_active: isActive } as never).eq("id", policyId);
  revalidatePath("/admin/refund-policies");
  return { success: true };
}

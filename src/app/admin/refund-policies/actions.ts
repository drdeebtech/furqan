"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routeAction } from "@/lib/actions/route-action";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

type ActionResult = { error?: string; success?: boolean };

const togglePolicyActiveBase = routeAction<{ policyId: string; isActive: boolean }, { message: string }>({
  name: "admin.refund-policies.toggle-active",
  role: "admin",
  severity: "warning",
  schema: z.object({ policyId: z.string().uuid(), isActive: z.boolean() }),
  audit: { table: "refund_policies", recordId: (i) => i.policyId, action: "UPDATE" },
  handler: async ({ policyId, isActive }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("refund_policies")
      .update({ is_active: isActive } satisfies TableUpdate<"refund_policies">)
      .eq("id", policyId);
    if (error) throw error;

    revalidatePath("/admin/refund-policies");
    return { message: isActive ? "تم تفعيل السياسة" : "تم تعطيل السياسة" };
  },
});

export async function togglePolicyActive(policyId: string, isActive: boolean): Promise<ActionResult> {
  const result = await togglePolicyActiveBase({ policyId, isActive });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

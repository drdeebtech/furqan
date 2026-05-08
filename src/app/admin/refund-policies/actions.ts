"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
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

const togglePolicyActiveBase = loudAction<{ policyId: string; isActive: boolean }, { message: string }>({
  name: "admin.refund-policies.toggle-active",
  severity: "warning",
  schema: z.object({ policyId: z.string().uuid(), isActive: z.boolean() }),
  audit: { table: "refund_policies", recordId: (i) => i.policyId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ policyId, isActive }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("refund_policies")
      .update({ is_active: isActive } as never)
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

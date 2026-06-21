"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAllowedSettingKey } from "@/lib/settings";
import { logError } from "@/lib/logger";
import { routeAction } from "@/lib/actions/route-action";
import { UserError } from "@/lib/actions/user-error";

type ActionResult = { error?: string; success?: boolean };

const updateSettingBase = routeAction<{ key: string; value: string }, { message: string }>({
  name: "admin.settings.update",
  role: "admin",
  severity: "info",
  schema: z.object({ key: z.string().min(1), value: z.string() }),
  // platform_settings is key-based — no UUID row id. record_id stays null;
  // the setting key is preserved in the diff audit row's reason below.
  audit: { table: "platform_settings", recordId: null, action: "UPDATE" },
  handler: async ({ key, value }, { actorId }) => {
    if (!isAllowedSettingKey(key)) throw new UserError("Invalid setting key");

    const supabase = await createClient();

    // Snapshot old value for the diff audit row (loudAction's envelope row
    // captures input-only; this row preserves what changed).
    const { data: previous } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", key)
      .single<{ value: string | null }>();

    const { error } = await supabase
      .from("platform_settings")
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      }, { onConflict: "key" });

    if (error) throw error;

    // Diff audit row — preserved from prior code. Distinct from the
    // loudAction envelope row in that it carries old/new value state.
    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "platform_settings",
      record_id: null,
      action: "UPDATE",
      old_data: { value: previous?.value ?? null },
      new_data: { value },
      reason: `Admin updated setting "${key}"`,
    }).then((r) => {
      if (r.error) logError("settings.updateSetting diff audit insert failed", r.error, { tag: "admin-settings" });
    });

    revalidatePath("/admin/settings");
    revalidateTag("platform-settings", "max");

    return { message: `تم تحديث الإعداد "${key}"` };
  },
});

export async function updateSetting(key: string, value: string): Promise<ActionResult> {
  const result = await updateSettingBase({ key, value });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

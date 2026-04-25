"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

export async function updateSetting(key: string, value: string) {
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const supabase = await createClient();

  // Capture old value for audit
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
    } as never, { onConflict: "key" });

  if (error) return { error: "فشل تحديث الإعداد" };

  await supabase.from("audit_log").insert({
    changed_by: actorId,
    table_name: "platform_settings",
    record_id: key,
    action: "UPDATE",
    old_data: { value: previous?.value ?? null },
    new_data: { value },
    reason: `Admin updated setting "${key}"`,
  } as never);

  revalidatePath("/admin/settings");
  return { success: true };
}

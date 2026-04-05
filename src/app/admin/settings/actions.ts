"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateSetting(key: string, value: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Verify admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();

  if (!profile || profile.role !== "admin") return { error: "غير مصرح" };

  const { error } = await supabase
    .from("platform_settings")
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    } as never, { onConflict: "key" });

  if (error) return { error: "فشل تحديث الإعداد" };

  revalidatePath("/admin/settings");
  return { success: true };
}

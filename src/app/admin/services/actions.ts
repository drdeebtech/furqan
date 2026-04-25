"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { requireAdmin as requireAdminStrict } from "@/lib/auth/require-admin";

async function requireAdmin() {
  await requireAdminStrict();
  return createClient();
}

export async function saveService(_prev: { success?: boolean }, formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string | null;
  const data = {
    title: formData.get("title") as string,
    title_ar: formData.get("title_ar") as string || null,
    description: formData.get("description") as string,
    description_ar: formData.get("description_ar") as string || null,
    features: (formData.get("features") as string || "").split("\n").map(s => s.trim()).filter(Boolean),
    features_ar: (formData.get("features_ar") as string || "").split("\n").map(s => s.trim()).filter(Boolean),
    icon: formData.get("icon") as string || null,
    image_url: formData.get("image_url") as string || null,
    display_order: parseInt(String(formData.get("display_order") ?? "0"), 10) || 0,
    is_active: formData.get("is_active") === "on",
  };

  if (id) {
    // as never: Supabase-generated types don't match runtime schema; safe workaround
    await supabase.from("services").update(data as never).eq("id", id);
  } else {
    // as never: Supabase-generated types don't match runtime schema; safe workaround
    await supabase.from("services").insert(data as never);
  }

  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

export async function deleteService(serviceId: string) {
  const supabase = await requireAdmin();
  const { error } = await supabase.from("services").delete().eq("id", serviceId);
  if (error) {
    logError("Failed to delete service", error, { tag: "admin-services" });
    return { error: "فشل حذف الخدمة" };
  }
  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

export async function toggleServiceActive(serviceId: string, isActive: boolean) {
  const supabase = await requireAdmin();
  // as never: Supabase-generated types don't match runtime schema; safe workaround
  const { error } = await supabase.from("services").update({ is_active: isActive } as never).eq("id", serviceId);
  if (error) {
    logError("Failed to toggle service active", error, { tag: "admin-services" });
    return { error: "فشل تحديث حالة الخدمة" };
  }
  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مصرح");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") throw new Error("ليس لديك صلاحية");
  return supabase;
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
    display_order: Number(formData.get("display_order") || 0),
    is_active: formData.get("is_active") === "on",
  };

  if (id) {
    await supabase.from("services").update(data as never).eq("id", id);
  } else {
    await supabase.from("services").insert(data as never);
  }

  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

export async function deleteService(serviceId: string) {
  const supabase = await requireAdmin();
  await supabase.from("services").delete().eq("id", serviceId);
  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

export async function toggleServiceActive(serviceId: string, isActive: boolean) {
  const supabase = await requireAdmin();
  await supabase.from("services").update({ is_active: isActive } as never).eq("id", serviceId);
  revalidatePath("/admin/services");
  revalidatePath("/services");
  return { success: true };
}

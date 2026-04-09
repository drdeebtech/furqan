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

export async function savePackage(_prev: { success?: boolean; error?: string }, formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string | null;

  const data = {
    package_type: formData.get("package_type") as string,
    name: formData.get("name") as string,
    name_ar: (formData.get("name_ar") as string) || null,
    description: (formData.get("description") as string) || null,
    description_ar: (formData.get("description_ar") as string) || null,
    session_count: parseInt(String(formData.get("session_count") ?? "1"), 10),
    duration_min: parseInt(String(formData.get("duration_min") ?? "30"), 10),
    price_usd: parseFloat(String(formData.get("price_usd") ?? "0")),
    price_gbp: formData.get("price_gbp") ? parseFloat(String(formData.get("price_gbp"))) : null,
    price_sar: formData.get("price_sar") ? parseFloat(String(formData.get("price_sar"))) : null,
    price_aud: formData.get("price_aud") ? parseFloat(String(formData.get("price_aud"))) : null,
    features: (formData.get("features") as string || "").split("\n").map(s => s.trim()).filter(Boolean),
    features_ar: (formData.get("features_ar") as string || "").split("\n").map(s => s.trim()).filter(Boolean),
    is_featured: formData.get("is_featured") === "on",
    is_active: formData.get("is_active") === "on",
    display_order: parseInt(String(formData.get("display_order") ?? "0"), 10) || 0,
  };

  if (!data.name || !data.package_type || data.price_usd <= 0 || data.session_count <= 0) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  if (id) {
    await supabase.from("packages").update(data as never).eq("id", id);
  } else {
    await supabase.from("packages").insert(data as never);
  }

  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

export async function deletePackage(packageId: string) {
  const supabase = await requireAdmin();
  const { error } = await supabase.from("packages").delete().eq("id", packageId);
  if (error) return { error: "فشل حذف الباقة — قد تكون مرتبطة بمشتريات طلاب" };
  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

export async function togglePackageActive(packageId: string, isActive: boolean) {
  const supabase = await requireAdmin();
  const { error } = await supabase.from("packages").update({ is_active: isActive } as never).eq("id", packageId);
  if (error) return { error: "فشل تحديث حالة الباقة" };
  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

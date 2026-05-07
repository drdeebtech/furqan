"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin as requireAdminStrict } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

async function requireAdminClient() {
  const { id } = await requireAdminStrict();
  return { actorId: id, supabase: await createClient() };
}

export async function savePackage(_prev: { success?: boolean; error?: string }, formData: FormData) {
  const { actorId, supabase } = await requireAdminClient();
  const id = formData.get("id") as string | null;

  const data: TableInsert<"packages"> = {
    // package_type is a text CHECK constraint (per CLAUDE.md enums table).
    // Narrowing cast documents the expected union at the form-input boundary.
    package_type: formData.get("package_type") as "trial" | "single_session" | "package" | "subscription" | "custom",
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
    const { data: previous } = await supabase
      .from("packages")
      .select("price_usd, name, is_active")
      .eq("id", id)
      .single<{ price_usd: number; name: string; is_active: boolean }>();
    const { error: updateErr } = await supabase.from("packages").update(data).eq("id", id);
    if (updateErr) {
      logError("admin.packages.update failed", updateErr, { tag: "admin-packages" });
      return { error: `فشل تحديث الباقة: ${updateErr.message}` };
    }
    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "packages",
      record_id: id,
      action: "UPDATE",
      old_data: previous ?? null,
      new_data: { price_usd: data.price_usd, name: data.name, is_active: data.is_active },
      reason: "Admin updated package",
    } as never).then((r) => {
      if (r.error) logError("upsertPackage(update): audit row failed", r.error, { tag: "admin-packages" });
    });
  } else {
    const { data: inserted } = await supabase
      .from("packages")
      .insert(data)
      .select("id")
      .single<{ id: string }>();
    if (inserted?.id) {
      await supabase.from("audit_log").insert({
        changed_by: actorId,
        table_name: "packages",
        record_id: inserted.id,
        action: "INSERT",
        old_data: null,
        new_data: { price_usd: data.price_usd, name: data.name, is_active: data.is_active },
        reason: "Admin created package",
      } as never).then((r) => {
        if (r.error) logError("upsertPackage(insert): audit row failed", r.error, { tag: "admin-packages" });
      });
    }
  }

  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

export async function deletePackage(packageId: string) {
  const { actorId, supabase } = await requireAdminClient();
  const { data: previous } = await supabase
    .from("packages")
    .select("name, price_usd")
    .eq("id", packageId)
    .single<{ name: string; price_usd: number }>();

  const { error } = await supabase.from("packages").delete().eq("id", packageId);
  if (error) {
    logError("admin deletePackage failed", error, { tag: "admin-packages", severity: "warning", metadata: { packageId, actorId } });
    return { error: "فشل حذف الباقة — قد تكون مرتبطة بمشتريات طلاب" };
  }

  await supabase.from("audit_log").insert({
    changed_by: actorId,
    table_name: "packages",
    record_id: packageId,
    action: "DELETE",
    old_data: previous ?? null,
    new_data: null,
    reason: "Admin deleted package",
  } as never).then((r) => {
    if (r.error) logError("deletePackage: audit row failed", r.error, { tag: "admin-packages" });
  });

  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

export async function togglePackageActive(packageId: string, isActive: boolean) {
  const { actorId, supabase } = await requireAdminClient();
  const { error } = await supabase.from("packages").update({ is_active: isActive } as never).eq("id", packageId);
  if (error) {
    logError("admin togglePackageActive failed", error, { tag: "admin-packages", severity: "warning", metadata: { packageId, isActive, actorId } });
    return { error: "فشل تحديث حالة الباقة" };
  }

  await supabase.from("audit_log").insert({
    changed_by: actorId,
    table_name: "packages",
    record_id: packageId,
    action: "UPDATE",
    old_data: { is_active: !isActive },
    new_data: { is_active: isActive },
    reason: isActive ? "Admin enabled package" : "Admin disabled package",
  } as never).then((r) => {
    if (r.error) logError("togglePackageActive: audit row failed", r.error, { tag: "admin-packages" });
  });

  revalidatePath("/admin/packages");
  revalidatePath("/packages");
  return { success: true };
}

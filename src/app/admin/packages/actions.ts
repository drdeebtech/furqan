"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin as requireAdminStrict, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

type ActionResult = { success?: boolean; error?: string };

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
}

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdminStrict();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
    throw e;
  }
}

function revalidatePackageSurfaces() {
  revalidatePath("/admin/packages");
  revalidatePath("/packages");
}

type SavePackageInput = { id: string | null; data: TableInsert<"packages"> };

const savePackageBase = loudAction<SavePackageInput, { message: string }>({
  name: "admin.packages.save",
  severity: "info",
  // Schema is intentionally permissive — the FormData decode below already
  // validates required fields with a UserError. Re-validating here would
  // duplicate logic for no gain.
  schema: z.object({ id: z.string().nullable(), data: z.record(z.string(), z.unknown()) }) as unknown as z.ZodType<SavePackageInput>,
  audit: {
    table: "packages",
    recordId: (i) => i.id ?? "(new)",
    action: "UPDATE",
    reasonPrefix: "admin save package",
  },
  preflight: adminPreflight,
  handler: async ({ id, data }, { actorId }) => {
    if (!data.name || !data.package_type || (data.price_usd ?? 0) <= 0 || (data.session_count ?? 0) <= 0) {
      throw new UserError("جميع الحقول المطلوبة يجب ملؤها");
    }
    const supabase = await createClient();

    if (id) {
      // Snapshot for the diff audit row — distinct from loudAction's
      // envelope row (which captures input-only). Same pattern as
      // updateSetting in PR 7.
      const { data: previous } = await supabase
        .from("packages")
        .select("price_usd, name, is_active")
        .eq("id", id)
        .single<{ price_usd: number; name: string; is_active: boolean }>();
      const { error: updateErr } = await supabase.from("packages").update(data).eq("id", id);
      if (updateErr) throw updateErr;
      await supabase.from("audit_log").insert({
        changed_by: actorId,
        table_name: "packages",
        record_id: id,
        action: "UPDATE",
        old_data: previous ?? null,
        new_data: { price_usd: data.price_usd, name: data.name, is_active: data.is_active },
        reason: "Admin updated package",
      }).then((r) => {
        if (r.error) logError("savePackage(update): diff audit row failed", r.error, { tag: "admin-packages" });
      });
      revalidatePackageSurfaces();
      return { message: "تم تحديث الباقة" };
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("packages")
      .insert(data)
      .select("id")
      .single<{ id: string }>();
    if (insertErr) throw insertErr;
    if (inserted?.id) {
      await supabase.from("audit_log").insert({
        changed_by: actorId,
        table_name: "packages",
        record_id: inserted.id,
        action: "INSERT",
        old_data: null,
        new_data: { price_usd: data.price_usd, name: data.name, is_active: data.is_active },
        reason: "Admin created package",
      }).then((r) => {
        if (r.error) logError("savePackage(insert): diff audit row failed", r.error, { tag: "admin-packages" });
      });
    }
    revalidatePackageSurfaces();
    return { message: "تم إنشاء الباقة" };
  },
});

export async function savePackage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = (formData.get("id") as string | null) || null;
  const data: TableInsert<"packages"> = {
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
  const result = await savePackageBase({ id, data });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const deletePackageBase = loudAction<{ packageId: string }, { message: string }>({
  name: "admin.packages.delete",
  // Destructive but expected — admin trying to delete a package linked to
  // student_packages will hit a FK rejection daily. `warning` keeps Sentry
  // capture without paging Telegram on every routine FK reject.
  severity: "warning",
  schema: z.object({ packageId: z.string().uuid() }),
  audit: {
    table: "packages",
    recordId: (i) => i.packageId,
    action: "DELETE",
    reasonPrefix: "admin delete package",
  },
  preflight: adminPreflight,
  handler: async ({ packageId }, { actorId }) => {
    const supabase = await createClient();
    const { data: previous } = await supabase
      .from("packages")
      .select("name, price_usd")
      .eq("id", packageId)
      .single<{ name: string; price_usd: number }>();

    const { error } = await supabase.from("packages").delete().eq("id", packageId);
    if (error) {
      // Preserve the existing user-facing message. NOTE (follow-up):
      // currently rebrands all errors as FK-linked; better would be to
      // detect Postgres code 23503 and only surface that message for
      // genuine FK violations. Leaving as-is to keep this PR scoped.
      throw new UserError("فشل حذف الباقة — قد تكون مرتبطة بمشتريات طلاب");
    }

    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "packages",
      record_id: packageId,
      action: "DELETE",
      old_data: previous ?? null,
      new_data: null,
      reason: "Admin deleted package",
    }).then((r) => {
      if (r.error) logError("deletePackage: diff audit row failed", r.error, { tag: "admin-packages" });
    });

    revalidatePackageSurfaces();
    return { message: "تم حذف الباقة" };
  },
});

export async function deletePackage(packageId: string): Promise<ActionResult> {
  const result = await deletePackageBase({ packageId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const togglePackageActiveBase = loudAction<{ packageId: string; isActive: boolean }, { message: string }>({
  name: "admin.packages.toggle-active",
  severity: "info",
  schema: z.object({ packageId: z.string().uuid(), isActive: z.boolean() }),
  audit: {
    table: "packages",
    recordId: (i) => i.packageId,
    action: "UPDATE",
    reasonPrefix: "admin toggle package active",
  },
  preflight: adminPreflight,
  handler: async ({ packageId, isActive }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase.from("packages").update({ is_active: isActive } as never).eq("id", packageId);
    if (error) throw error;

    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "packages",
      record_id: packageId,
      action: "UPDATE",
      old_data: { is_active: !isActive },
      new_data: { is_active: isActive },
      reason: isActive ? "Admin enabled package" : "Admin disabled package",
    }).then((r) => {
      if (r.error) logError("togglePackageActive: diff audit row failed", r.error, { tag: "admin-packages" });
    });

    revalidatePackageSurfaces();
    return { message: isActive ? "تم التفعيل" : "تم التعطيل" };
  },
});

export async function togglePackageActive(packageId: string, isActive: boolean): Promise<ActionResult> {
  const result = await togglePackageActiveBase({ packageId, isActive });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

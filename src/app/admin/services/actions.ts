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

const saveServiceSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().min(1, "العنوان مطلوب"),
  title_ar: z.string().nullable(),
  description: z.string().min(1, "الوصف مطلوب"),
  description_ar: z.string().nullable(),
  features: z.array(z.string()),
  features_ar: z.array(z.string()),
  icon: z.string().nullable(),
  image_url: z.string().nullable(),
  display_order: z.number().int(),
  is_active: z.boolean(),
});

const saveServiceBase = loudAction<z.infer<typeof saveServiceSchema>, { message: string }>({
  name: "admin.services.save",
  severity: "warning",
  schema: saveServiceSchema,
  audit: {
    table: "services",
    recordId: (i) => i.id ?? "new",
    action: "UPDATE",
  },
  preflight: adminPreflight,
  handler: async (input) => {
    const supabase = await createClient();
    const { id, ...row } = input;

    const { error } = id
      ? await supabase.from("services").update(row).eq("id", id)
      : await supabase.from("services").insert(row);
    if (error) throw error;

    revalidatePath("/admin/services");
    revalidatePath("/services");
    return { message: id ? "تم تحديث الخدمة" : "تم إنشاء الخدمة" };
  },
});

export async function saveService(_prev: { success?: boolean }, formData: FormData): Promise<ActionResult> {
  const idRaw = formData.get("id");
  const result = await saveServiceBase({
    id: idRaw && String(idRaw) ? String(idRaw) : null,
    title: String(formData.get("title") ?? ""),
    title_ar: String(formData.get("title_ar") ?? "") || null,
    description: String(formData.get("description") ?? ""),
    description_ar: String(formData.get("description_ar") ?? "") || null,
    features: String(formData.get("features") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    features_ar: String(formData.get("features_ar") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    icon: String(formData.get("icon") ?? "") || null,
    image_url: String(formData.get("image_url") ?? "") || null,
    display_order: parseInt(String(formData.get("display_order") ?? "0"), 10) || 0,
    is_active: formData.get("is_active") === "on",
  });

  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}

const deleteServiceBase = loudAction<{ serviceId: string }, { message: string }>({
  name: "admin.services.delete",
  severity: "warning",
  schema: z.object({ serviceId: z.string().uuid() }),
  audit: { table: "services", recordId: (i) => i.serviceId, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ serviceId }) => {
    const supabase = await createClient();
    const { error } = await supabase.from("services").delete().eq("id", serviceId);
    if (error) throw error;

    revalidatePath("/admin/services");
    revalidatePath("/services");
    return { message: "تم حذف الخدمة" };
  },
});

export async function deleteService(serviceId: string): Promise<ActionResult> {
  const result = await deleteServiceBase({ serviceId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const toggleServiceActiveBase = loudAction<{ serviceId: string; isActive: boolean }, { message: string }>({
  name: "admin.services.toggle-active",
  severity: "warning",
  schema: z.object({ serviceId: z.string().uuid(), isActive: z.boolean() }),
  audit: { table: "services", recordId: (i) => i.serviceId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ serviceId, isActive }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("services")
      .update({ is_active: isActive })
      .eq("id", serviceId);
    if (error) throw error;

    revalidatePath("/admin/services");
    revalidatePath("/services");
    return { message: isActive ? "تم تفعيل الخدمة" : "تم تعطيل الخدمة" };
  },
});

export async function toggleServiceActive(serviceId: string, isActive: boolean): Promise<ActionResult> {
  const result = await toggleServiceActiveBase({ serviceId, isActive });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

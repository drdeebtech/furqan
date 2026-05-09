"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";
import type { AnnouncementSeverity } from "@/types/database";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
}

// Public return type — preserved from prior shape so existing callers
// (announcement-form.tsx reads state.success and state.error) keep
// working untouched. The `id` field is declared but is dead code today
// (no caller reads it after createAnnouncement); kept for backward
// compatibility, may be dropped in a future cleanup PR.
export interface AnnouncementResult {
  success?: string;
  error?: string;
  id?: string;
}

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new UserError(e.message === "not authenticated" ? "غير مسجل الدخول" : "ليس لديك صلاحية");
    }
    throw e;
  }
}

const announcementFieldsSchema = z
  .object({
    message_ar: z.string().min(1, "النص العربي مطلوب"),
    message_en: z.string().min(1, "النص الإنجليزي مطلوب"),
    severity: z.enum(["info", "warning", "critical"], { message: "درجة التنبيه غير صحيحة" }),
    is_dismissible: z.boolean(),
    active_from_raw: z.string().min(1, "تاريخ البدء مطلوب"),
    active_until_raw: z.string(),
    cta_label_ar: z.string().nullable(),
    cta_label_en: z.string().nullable(),
    cta_href: z.string().nullable(),
  })
  .superRefine((d, ctx) => {
    const ctaSet = [d.cta_label_ar, d.cta_label_en, d.cta_href].filter(Boolean).length;
    if (ctaSet > 0 && ctaSet < 3) {
      ctx.addIssue({
        code: "custom",
        message: "إذا أدخلت رابط CTA فأدخل كل الحقول الثلاثة",
        path: ["cta_href"],
      });
    }
    if (d.active_until_raw && new Date(d.active_until_raw) <= new Date(d.active_from_raw)) {
      ctx.addIssue({
        code: "custom",
        message: "تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء",
        path: ["active_until_raw"],
      });
    }
  });

type AnnouncementFields = {
  message_ar: string;
  message_en: string;
  severity: AnnouncementSeverity;
  is_dismissible: boolean;
  active_from: string;
  active_until: string | null;
  cta_label_ar: string | null;
  cta_label_en: string | null;
  cta_href: string | null;
};

function parseFormData(formData: FormData) {
  return {
    message_ar: String(formData.get("message_ar") ?? "").trim(),
    message_en: String(formData.get("message_en") ?? "").trim(),
    severity: String(formData.get("severity") ?? "info") as AnnouncementSeverity,
    is_dismissible: formData.get("is_dismissible") === "on",
    active_from_raw: String(formData.get("active_from") ?? "").trim(),
    active_until_raw: String(formData.get("active_until") ?? "").trim(),
    cta_label_ar: String(formData.get("cta_label_ar") ?? "").trim() || null,
    cta_label_en: String(formData.get("cta_label_en") ?? "").trim() || null,
    cta_href: String(formData.get("cta_href") ?? "").trim() || null,
  };
}

function toRow(input: z.infer<typeof announcementFieldsSchema>): AnnouncementFields {
  return {
    message_ar: input.message_ar,
    message_en: input.message_en,
    severity: input.severity,
    is_dismissible: input.is_dismissible,
    active_from: new Date(input.active_from_raw).toISOString(),
    active_until: input.active_until_raw ? new Date(input.active_until_raw).toISOString() : null,
    cta_label_ar: input.cta_label_ar,
    cta_label_en: input.cta_label_en,
    cta_href: input.cta_href,
  };
}

const createAnnouncementBase = loudAction<z.infer<typeof announcementFieldsSchema>, { message: string }>({
  name: "admin.announcements.create",
  severity: "warning",
  schema: announcementFieldsSchema,
  audit: { table: "site_announcements", recordId: () => "new", action: "INSERT" },
  preflight: adminPreflight,
  handler: async (input, { actorId }) => {
    const admin = createAdminClient();
    const { error } = await admin
      .from("site_announcements")
      .insert({ ...toRow(input), created_by: actorId });

    if (error) throw error;

    revalidatePath("/admin/announcements");
    revalidatePath("/");
    return { message: "تم إنشاء التنبيه" };
  },
});

export async function createAnnouncement(
  _prev: AnnouncementResult,
  formData: FormData,
): Promise<AnnouncementResult> {
  const result = await createAnnouncementBase(parseFormData(formData));
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const updateAnnouncementBase = loudAction<
  { id: string } & z.infer<typeof announcementFieldsSchema>,
  { message: string }
>({
  name: "admin.announcements.update",
  severity: "warning",
  audit: { table: "site_announcements", recordId: (i) => i.id, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ id, ...fields }) => {
    // Validate the announcement fields here since loudAction's `schema:`
    // expected a single uniform Zod type and the input has an extra `id`
    // we don't want to push through the announcement schema's superRefine.
    const parsed = announcementFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      const errorMessage = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
        .join(" • ");
      throw new UserError(`بيانات غير صالحة — ${errorMessage}`);
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new UserError("معرّف غير صالح");
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("site_announcements")
      .update(toRow(parsed.data))
      .eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/announcements");
    revalidatePath("/");
    return { message: "تم حفظ التنبيه" };
  },
});

export async function updateAnnouncement(
  id: string,
  _prev: AnnouncementResult,
  formData: FormData,
): Promise<AnnouncementResult> {
  const result = await updateAnnouncementBase({ id, ...parseFormData(formData) });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const deleteAnnouncementBase = loudAction<{ id: string }, { message: string }>({
  name: "admin.announcements.delete",
  severity: "warning",
  schema: z.object({ id: z.string().uuid() }),
  audit: { table: "site_announcements", recordId: (i) => i.id, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ id }) => {
    const admin = createAdminClient();
    const { error } = await admin.from("site_announcements").delete().eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/announcements");
    revalidatePath("/");
    return { message: "تم الحذف" };
  },
});

export async function deleteAnnouncement(id: string): Promise<AnnouncementResult> {
  const result = await deleteAnnouncementBase({ id });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const deactivateAnnouncementBase = loudAction<{ id: string }, { message: string }>({
  name: "admin.announcements.deactivate",
  severity: "warning",
  schema: z.object({ id: z.string().uuid() }),
  audit: { table: "site_announcements", recordId: (i) => i.id, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ id }) => {
    const admin = createAdminClient();
    const { error } = await admin
      .from("site_announcements")
      .update({ active_until: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/announcements");
    revalidatePath("/");
    return { message: "تم إيقاف التنبيه" };
  },
});

export async function deactivateAnnouncement(id: string): Promise<AnnouncementResult> {
  const result = await deactivateAnnouncementBase({ id });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

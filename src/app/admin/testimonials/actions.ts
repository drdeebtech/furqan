"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

// Mirrors the announcements result shape so the shared <ActionFeedback> and
// useActionState wiring work unchanged.
export interface TestimonialResult {
  success?: string;
  error?: string;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const testimonialFieldsSchema = z.object({
  author_name: z.string().min(1, "اسم صاحب الرأي مطلوب").max(120),
  author_location: z.string().max(120).nullable(),
  quote_ar: z.string().min(1, "النص العربي مطلوب").max(1000),
  quote_en: z.string().max(1000).nullable(),
  is_published: z.boolean(),
  display_order: z.number().int().min(0).max(9999),
});

type TestimonialFields = z.infer<typeof testimonialFieldsSchema>;

function parseFormData(formData: FormData): TestimonialFields {
  const orderRaw = String(formData.get("display_order") ?? "0").trim();
  const order = Number.parseInt(orderRaw, 10);
  return {
    author_name: String(formData.get("author_name") ?? "").trim(),
    author_location: String(formData.get("author_location") ?? "").trim() || null,
    quote_ar: String(formData.get("quote_ar") ?? "").trim(),
    quote_en: String(formData.get("quote_en") ?? "").trim() || null,
    is_published: formData.get("is_published") === "on",
    display_order: order,
  };
}

function revalidatePublic() {
  // The public layout reads getPublishedTestimonials() under this tag.
  revalidateTag("testimonials-public", "max");
  revalidatePath("/admin/testimonials");
}

const createTestimonialBase = loudAction<TestimonialFields, { message: string }>({
  name: "admin.testimonials.create",
  severity: "warning",
  schema: testimonialFieldsSchema,
  audit: { table: "testimonials", recordId: () => null, action: "INSERT" },
  preflight: adminPreflight,
  handler: async (input) => {
    const admin = createAdminClient();
    const { error } = await admin.from("testimonials").insert(input);
    if (error) throw error;
    revalidatePublic();
    return { message: "تم إنشاء الشهادة" };
  },
});

export async function createTestimonial(
  _prev: TestimonialResult,
  formData: FormData,
): Promise<TestimonialResult> {
  const result = await createTestimonialBase(parseFormData(formData));
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const updateTestimonialBase = loudAction<{ id: string } & TestimonialFields, { message: string }>({
  name: "admin.testimonials.update",
  severity: "warning",
  audit: { table: "testimonials", recordId: (i) => i.id, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ id, ...fields }) => {
    const parsed = testimonialFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      throw new UserError(
        `بيانات غير صالحة — ${parsed.error.issues.map((i) => i.message).join(" • ")}`,
      );
    }
    if (!UUID_RE.test(id)) throw new UserError("معرّف غير صالح");
    const admin = createAdminClient();
    const { data: updated, error } = await admin.from("testimonials").update(parsed.data).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!updated) throw new UserError("لم يُعثر على الشهادة");
    revalidatePublic();
    return { message: "تم حفظ الشهادة" };
  },
});

export async function updateTestimonial(
  id: string,
  _prev: TestimonialResult,
  formData: FormData,
): Promise<TestimonialResult> {
  const result = await updateTestimonialBase({ id, ...parseFormData(formData) });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const togglePublishBase = loudAction<{ id: string; publish: boolean }, { message: string }>({
  name: "admin.testimonials.toggle-publish",
  severity: "warning",
  schema: z.object({ id: z.string().uuid(), publish: z.boolean() }),
  audit: { table: "testimonials", recordId: (i) => i.id, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ id, publish }) => {
    const admin = createAdminClient();
    const { data: updated, error } = await admin.from("testimonials").update({ is_published: publish }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!updated) throw new UserError("لم يُعثر على الشهادة");
    revalidatePublic();
    return { message: publish ? "تم النشر" : "تم إلغاء النشر" };
  },
});

export async function togglePublishTestimonial(
  id: string,
  publish: boolean,
): Promise<TestimonialResult> {
  const result = await togglePublishBase({ id, publish });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

const deleteTestimonialBase = loudAction<{ id: string }, { message: string }>({
  name: "admin.testimonials.delete",
  severity: "warning",
  schema: z.object({ id: z.string().uuid() }),
  audit: { table: "testimonials", recordId: (i) => i.id, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ id }) => {
    const admin = createAdminClient();
    const { data: deleted, error } = await admin.from("testimonials").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!deleted) throw new UserError("لم يُعثر على الشهادة");
    revalidatePublic();
    return { message: "تم الحذف" };
  },
});

export async function deleteTestimonial(id: string): Promise<TestimonialResult> {
  const result = await deleteTestimonialBase({ id });
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

export interface ResourceFormState {
  ok?: boolean;
  error?: string;
  id?: string;
}

const VALID_TYPES = ["pdf", "audio", "link", "video", "image"] as const;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB cap on uploads

async function guardAdmin(): Promise<{ id: string } | { error: string }> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }
}

// ─── saveResource ───────────────────────────────────────────────────────────
// Single upsert handler. If a `file` is uploaded, it goes to the `resources`
// storage bucket and `file_url` is set to the public URL. `external_url` is
// always optional. At least one of file/external_url must be present (DB
// CHECK constraint enforces this too).

export async function saveResource(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const auth = await guardAdmin();
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim() || null;
  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const title_en = String(formData.get("title_en") ?? "").trim() || null;
  const description_ar = String(formData.get("description_ar") ?? "").trim() || null;
  const description_en = String(formData.get("description_en") ?? "").trim() || null;
  const resource_type = String(formData.get("resource_type") ?? "");
  const category = String(formData.get("category") ?? "general").trim() || "general";
  const external_url_raw = String(formData.get("external_url") ?? "").trim() || null;
  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const is_published = formData.get("is_published") === "on";
  const fileEntry = formData.get("file");

  if (!title_ar) return { error: "العنوان بالعربية مطلوب" };
  if (!(VALID_TYPES as readonly string[]).includes(resource_type)) {
    return { error: "نوع غير صالح" };
  }

  const tags = tagsRaw
    ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Optional file upload: store in `resources` bucket via admin client (so
  // RLS doesn't gate us; we already gated the action with requireAdmin above).
  let file_url: string | null = null;
  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return { error: "الملف كبير جدًا — الحد الأقصى 50 ميغابايت" };
    }
    const adminClient = createAdminClient();
    const ext = fileEntry.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${resource_type}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await adminClient.storage
      .from("resources")
      .upload(path, fileEntry, {
        contentType: fileEntry.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) {
      logError("resources.saveResource upload failed", upErr, { tag: "resources" });
      return { error: `فشل رفع الملف: ${upErr.message}` };
    }
    const { data: pub } = adminClient.storage.from("resources").getPublicUrl(path);
    file_url = pub?.publicUrl ?? null;
    if (!file_url) return { error: "تعذر إنشاء رابط الملف" };
  }

  if (!file_url && !external_url_raw && !id) {
    return { error: "يجب رفع ملف أو إضافة رابط خارجي" };
  }

  const supabase = await createClient();

  if (id) {
    const update: TableUpdate<"resources"> = {
      title_ar, title_en, description_ar, description_en,
      resource_type, category, tags, is_published,
    };
    // Only update file_url if a new file was uploaded; preserve existing
    // otherwise.
    if (file_url) update.file_url = file_url;
    if (external_url_raw !== null) update.external_url = external_url_raw;
    const { error } = await supabase.from("resources").update(update).eq("id", id);
    if (error) {
      logError("resources.saveResource update failed", error, { tag: "resources" });
      return { error: error.message };
    }
    revalidatePath("/admin/resources");
    revalidatePath("/student/resources");
    return { ok: true, id };
  }

  const insert: TableInsert<"resources"> = {
    title_ar, title_en, description_ar, description_en,
    resource_type, category, tags, is_published,
    file_url, external_url: external_url_raw,
    uploaded_by: auth.id,
  };
  const { data, error } = await supabase
    .from("resources")
    .insert(insert)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error) logError("resources.saveResource insert failed", error, { tag: "resources" });
    return { error: error?.message ?? "لم يتم إنشاء السجل" };
  }
  revalidatePath("/admin/resources");
  revalidatePath("/student/resources");
  return { ok: true, id: data.id };
}

// ─── deleteResource ─────────────────────────────────────────────────────────

export async function deleteResource(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await guardAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase.from("resources").delete().eq("id", id);
  if (error) {
    logError("resources.deleteResource failed", error, { tag: "resources", id });
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/resources");
  revalidatePath("/student/resources");
  return { ok: true };
}

// ─── toggleResourcePublished ────────────────────────────────────────────────

export async function toggleResourcePublished(
  id: string,
  next: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await guardAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("resources")
    .update({ is_published: next } satisfies TableUpdate<"resources">)
    .eq("id", id);
  if (error) {
    logError("resources.toggleResourcePublished failed", error, { tag: "resources", id });
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/resources");
  revalidatePath("/student/resources");
  return { ok: true };
}

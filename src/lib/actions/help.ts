"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

export interface HelpFormState {
  ok?: boolean;
  error?: string;
  id?: string;
  slug?: string;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

async function guardAdmin(): Promise<{ id: string } | { error: string }> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }
}

// ─── saveArticle ─────────────────────────────────────────────────────────────
// Returns { ok?, id?, slug?, error? } — id and slug must be preserved for
// callers; keep manual pattern per rule 6.

export async function saveArticle(
  _prev: HelpFormState,
  formData: FormData,
): Promise<HelpFormState> {
  const auth = await guardAdmin();
  if ("error" in auth) return auth;

  const id = String(formData.get("id") ?? "").trim() || null;
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const title_en = String(formData.get("title_en") ?? "").trim() || null;
  const body_ar = String(formData.get("body_ar") ?? "").trim();
  const body_en = String(formData.get("body_en") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim();
  const sort_order = Number(formData.get("sort_order") ?? 0) || 0;
  const is_published = formData.get("is_published") === "on";

  if (!slug || !SLUG_RE.test(slug)) {
    return { error: "الـ slug يجب أن يكون أحرفًا/أرقامًا/شرطات صغيرة فقط" };
  }
  if (!title_ar) return { error: "العنوان بالعربية مطلوب" };
  if (!body_ar) return { error: "المحتوى بالعربية مطلوب" };
  if (!category) return { error: "التصنيف مطلوب" };

  const supabase = await createClient();

  if (id) {
    const update: TableUpdate<"help_articles"> = {
      slug, title_ar, title_en, body_ar, body_en,
      category, sort_order, is_published,
    };
    const { error } = await supabase.from("help_articles").update(update).eq("id", id);
    if (error) {
      logError("help.saveArticle update failed", error, { tag: "help" });
      return { error: error.message };
    }
    revalidatePath("/admin/help");
    revalidatePath(`/help/${slug}`);
    revalidatePath("/help");
    return { ok: true, id, slug };
  }

  const insert: TableInsert<"help_articles"> = {
    slug, title_ar, title_en, body_ar, body_en,
    category, sort_order, is_published,
    created_by: auth.id,
  };
  const { data, error } = await supabase
    .from("help_articles")
    .insert(insert)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error?.message.includes("duplicate")) {
      return { error: "هذا الـ slug مستخدم بالفعل" };
    }
    if (error) logError("help.saveArticle insert failed", error, { tag: "help" });
    return { error: error?.message ?? "لم يتم إنشاء السجل" };
  }
  revalidatePath("/admin/help");
  revalidatePath("/help");
  return { ok: true, id: data.id, slug };
}

// ─── deleteArticle ──────────────────────────────────────────────────────────

const deleteArticleBase = loudAction<{ id: string }, void>({
  name: "help.deleteArticle",
  severity: "warning",
  handler: async ({ id }) => {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
      throw e;
    }
    const supabase = await createClient();
    const { error } = await supabase.from("help_articles").delete().eq("id", id);
    if (error) throw new UserError("فشل حذف المقال", { cause: error });

    revalidatePath("/admin/help");
    revalidatePath("/help");
  },
});

export async function deleteArticle(id: string) {
  return deleteArticleBase({ id });
}

// ─── togglePublished ────────────────────────────────────────────────────────

const togglePublishedBase = loudAction<{ id: string; next: boolean }, void>({
  name: "help.togglePublished",
  handler: async ({ id, next }) => {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
      throw e;
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("help_articles")
      .update({ is_published: next } satisfies TableUpdate<"help_articles">)
      .eq("id", id);
    if (error) throw new UserError("فشل تحديث حالة النشر", { cause: error });

    revalidatePath("/admin/help");
    revalidatePath("/help");
  },
});

export async function togglePublished(id: string, next: boolean) {
  return togglePublishedBase({ id, next });
}

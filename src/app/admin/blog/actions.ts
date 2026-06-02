"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { loudAction } from "@/lib/actions/loud";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
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

const CATEGORIES: Record<string, { ar: string; color: string }> = {
  Hifz: { ar: "حفظ القرآن", color: "text-success border-success/30 bg-success/10" },
  Tajweed: { ar: "تجويد", color: "text-gold border-gold/30 bg-gold/10" },
  Tips: { ar: "نصائح", color: "text-warning border-warning/30 bg-warning/10" },
  Children: { ar: "للأطفال", color: "text-pink-400 border-pink-500/30 bg-pink-500/10" },
  Qiraat: { ar: "القراءات", color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
  Tafsir: { ar: "تفسير", color: "text-warning border-warning/30 bg-warning/10" },
};

// savePost is a state-returning + redirect-style hybrid: returns { error }
// on failure, redirects on success. With loudAction's isRedirectError patch
// (PR #250), the redirect() throw propagates correctly through the wrapper.
// The `id` parameter (when present) makes this an UPDATE; absence makes it
// an INSERT — captured in the audit envelope as "save" since the row id
// isn't known on insert until after the row is created.
const savePostBase = loudAction<
  {
    id: string | null;
    categoryEn: string;
    isPublished: boolean;
    slug: string;
    title_ar: string;
    title_en: string;
    excerpt_ar: string;
    excerpt_en: string;
    body_ar: string;
    body_en: string;
    read_time_ar: string;
    read_time_en: string;
    cover_alt_ar: string | null;
    cover_alt_en: string | null;
    coverFile: File | null;
  },
  { message: string }
>({
  name: "admin.blog.save",
  severity: "warning",
  audit: { table: "blog_posts", recordId: (i) => i.id ?? "new", action: "UPDATE" },
  preflight: adminPreflight,
  handler: async (input) => {
    const supabase = await createClient();
    const cat = CATEGORIES[input.categoryEn];
    if (!cat) throw new UserError("اختر التصنيف");

    if (!input.slug) throw new UserError("الرابط الفريد مطلوب");
    if (!input.title_ar) throw new UserError("العنوان العربي مطلوب");
    if (!input.title_en) throw new UserError("العنوان الإنجليزي مطلوب");

    const row: TableInsert<"blog_posts"> = {
      slug: input.slug,
      title_ar: input.title_ar,
      title_en: input.title_en,
      excerpt_ar: input.excerpt_ar,
      excerpt_en: input.excerpt_en,
      body_ar: input.body_ar,
      body_en: input.body_en,
      category_ar: cat.ar,
      category_en: input.categoryEn,
      color: cat.color,
      read_time_ar: input.read_time_ar || "٥ دقائق",
      read_time_en: input.read_time_en || "5 min",
      is_published: input.isPublished,
      cover_alt_en: input.cover_alt_en,
      cover_alt_ar: input.cover_alt_ar,
      updated_at: new Date().toISOString(),
    };

    let postId: string;
    if (input.id) {
      const { error } = await supabase.from("blog_posts").update(row).eq("id", input.id);
      if (error) throw error;
      postId = input.id;
    } else {
      const { data, error } = await supabase.from("blog_posts").insert(row).select("id").single();
      if (error || !data) throw error ?? new Error("حدث خطأ أثناء الإنشاء");
      postId = (data as { id: string }).id;
    }

    // Cover image upload — optional. Path: blog-images/{post_id}/cover.{ext}
    if (input.coverFile && input.coverFile.size > 0) {
      const ext = (input.coverFile.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${postId}/cover.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("blog-images")
        .upload(path, input.coverFile, { upsert: true, contentType: input.coverFile.type });
      if (upErr) throw new Error("فشل رفع صورة الغلاف");
      const { error: pathErr } = await supabase
        .from("blog_posts")
        .update({ cover_image_path: path } satisfies TableUpdate<"blog_posts">)
        .eq("id", postId);
      if (pathErr) {
        // Soft-fail: image uploaded but path update failed. Log and continue —
        // the post saved successfully; admin can re-upload to fix the path.
        logError("blog cover path update failed", pathErr, { tag: "admin-blog", metadata: { postId } });
      }
    }

    revalidatePath("/admin/blog");
    revalidatePath("/blog");
    revalidateTag("blog-public", "max"); // Next.js Data Cache
    await invalidateByTag("blog-public"); // CDN edge cache

    // redirect() throws NEXT_REDIRECT — loudAction's isRedirectError branch
    // re-throws so Next.js sees the redirect, while writing the audit envelope
    // row as success. See loud.ts isRedirectError branch (PR #250).
    redirect("/admin/blog");
  },
});

export async function savePost(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string } | null> {
  const idRaw = formData.get("id");
  const result = await savePostBase({
    id: idRaw && String(idRaw) ? String(idRaw) : null,
    categoryEn: String(formData.get("category_en") ?? ""),
    isPublished: formData.has("is_published"),
    slug: String(formData.get("slug") ?? ""),
    title_ar: String(formData.get("title_ar") ?? ""),
    title_en: String(formData.get("title_en") ?? ""),
    excerpt_ar: String(formData.get("excerpt_ar") ?? ""),
    excerpt_en: String(formData.get("excerpt_en") ?? ""),
    body_ar: String(formData.get("body_ar") ?? ""),
    body_en: String(formData.get("body_en") ?? ""),
    read_time_ar: String(formData.get("read_time_ar") ?? ""),
    read_time_en: String(formData.get("read_time_en") ?? ""),
    cover_alt_ar: String(formData.get("cover_alt_ar") ?? "").trim() || null,
    cover_alt_en: String(formData.get("cover_alt_en") ?? "").trim() || null,
    coverFile: formData.get("cover_image") as File | null,
  });
  // Unreachable on success path — handler calls redirect() which propagates
  // through loudAction's isRedirectError branch. We only reach here on failure.
  if (!result.ok) return { error: result.error };
  return null;
}

const deletePostBase = loudAction<{ postId: string }, { message: string }>({
  name: "admin.blog.delete",
  severity: "warning",
  schema: z.object({ postId: z.string().uuid() }),
  audit: { table: "blog_posts", recordId: (i) => i.postId, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ postId }) => {
    const supabase = await createClient();
    const { error } = await supabase.from("blog_posts").delete().eq("id", postId);
    if (error) throw error;

    revalidatePath("/admin/blog");
    revalidatePath("/blog");
    revalidateTag("blog-public", "max");
    await invalidateByTag("blog-public");
    return { message: "تم حذف المقال" };
  },
});

export async function deletePost(postId: string): Promise<ActionResult> {
  const result = await deletePostBase({ postId });
  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}

const togglePublishedBase = loudAction<{ postId: string; isPublished: boolean }, { message: string }>({
  name: "admin.blog.toggle-published",
  severity: "warning",
  schema: z.object({ postId: z.string().uuid(), isPublished: z.boolean() }),
  audit: { table: "blog_posts", recordId: (i) => i.postId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ postId, isPublished }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("blog_posts")
      .update({ is_published: isPublished })
      .eq("id", postId);
    if (error) throw error;

    revalidatePath("/admin/blog");
    revalidatePath("/blog");
    revalidateTag("blog-public", "max");
    await invalidateByTag("blog-public");
    return { message: isPublished ? "تم نشر المقال" : "تم إخفاء المقال" };
  },
});

export async function togglePublished(postId: string, isPublished: boolean): Promise<ActionResult> {
  const result = await togglePublishedBase({ postId, isPublished });
  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

const CATEGORIES: Record<string, { ar: string; color: string }> = {
  Hifz: { ar: "حفظ القرآن", color: "text-success border-success/30 bg-success/10" },
  Tajweed: { ar: "تجويد", color: "text-gold border-gold/30 bg-gold/10" },
  Tips: { ar: "نصائح", color: "text-warning border-warning/30 bg-warning/10" },
  Children: { ar: "للأطفال", color: "text-pink-400 border-pink-500/30 bg-pink-500/10" },
  Qiraat: { ar: "القراءات", color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
  Tafsir: { ar: "تفسير", color: "text-warning border-warning/30 bg-warning/10" },
};

export async function savePost(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const id = formData.get("id") as string | null;
  const categoryEn = formData.get("category_en") as string;
  const cat = CATEGORIES[categoryEn];
  const isPublished = formData.has("is_published");

  if (!categoryEn || !cat) return { error: "اختر التصنيف" };

  const coverAltEn = ((formData.get("cover_alt_en") as string | null) ?? "").trim() || null;
  const coverAltAr = ((formData.get("cover_alt_ar") as string | null) ?? "").trim() || null;

  // Phase 4h proof-of-concept: typing the bare-variable explicitly with
  // TableInsert<"blog_posts"> drops the need for `(row as never)` casts at
  // the use sites. The same pattern works for the 16 other bare-variable
  // sites flagged by the Phase 4h audit; each needs per-file conversion.
  const row: TableInsert<"blog_posts"> = {
    slug: formData.get("slug") as string,
    title_ar: formData.get("title_ar") as string,
    title_en: formData.get("title_en") as string,
    excerpt_ar: formData.get("excerpt_ar") as string,
    excerpt_en: formData.get("excerpt_en") as string,
    body_ar: formData.get("body_ar") as string,
    body_en: formData.get("body_en") as string,
    category_ar: cat.ar,
    category_en: categoryEn,
    color: cat.color,
    read_time_ar: (formData.get("read_time_ar") as string) || "٥ دقائق",
    read_time_en: (formData.get("read_time_en") as string) || "5 min",
    is_published: isPublished,
    cover_alt_en: coverAltEn,
    cover_alt_ar: coverAltAr,
    updated_at: new Date().toISOString(),
  };

  let postId: string;
  if (id) {
    const { error } = await supabase.from("blog_posts").update(row).eq("id", id);
    if (error) {
      logError("admin blog update failed", error, { tag: "admin-blog", severity: "warning", metadata: { postId: id } });
      return { error: "حدث خطأ أثناء التحديث" };
    }
    postId = id;
  } else {
    const { data, error } = await supabase.from("blog_posts").insert(row).select("id").single();
    if (error || !data) {
      logError("admin blog insert failed", error, { tag: "admin-blog", severity: "warning" });
      return { error: "حدث خطأ أثناء الإنشاء" };
    }
    postId = (data as { id: string }).id;
  }

  // Cover image upload — optional. Path: blog-images/{post_id}/cover.{ext}
  const coverFile = formData.get("cover_image") as File | null;
  if (coverFile && coverFile.size > 0) {
    const ext = (coverFile.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `${postId}/cover.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("blog-images")
      .upload(path, coverFile, { upsert: true, contentType: coverFile.type });
    if (upErr) {
      logError("blog cover upload failed", upErr, { tag: "admin-blog", severity: "warning", metadata: { postId } });
      return { error: "فشل رفع صورة الغلاف" };
    }
    const { error: pathErr } = await supabase
      .from("blog_posts")
      .update({ cover_image_path: path } as never)
      .eq("id", postId);
    if (pathErr) {
      logError("blog cover path update failed", pathErr, { tag: "admin-blog", metadata: { postId } });
    }
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidateTag("blog-public", "max"); // Next.js Data Cache
  await invalidateByTag("blog-public"); // CDN edge cache
  redirect("/admin/blog");
}

export async function deletePost(postId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("blog_posts").delete().eq("id", postId);
  if (error) {
    logError("admin.deletePost failed", error, { tag: "admin-blog" });
    return { success: false, error: error.message };
  }
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidateTag("blog-public", "max"); // Next.js Data Cache
  await invalidateByTag("blog-public"); // CDN edge cache
  return { success: true };
}

export async function togglePublished(postId: string, isPublished: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("blog_posts").update({ is_published: isPublished }).eq("id", postId);
  if (error) {
    logError("admin.togglePublished failed", error, { tag: "admin-blog" });
    return { success: false, error: error.message };
  }
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidateTag("blog-public", "max"); // Next.js Data Cache
  await invalidateByTag("blog-public"); // CDN edge cache
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

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

  const row = {
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
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("blog_posts").update(row).eq("id", id);
    if (error) {
      logError("admin blog update failed", error, { tag: "admin-blog", severity: "warning", metadata: { postId: id } });
      return { error: "حدث خطأ أثناء التحديث" };
    }
  } else {
    const { error } = await supabase.from("blog_posts").insert(row);
    if (error) {
      logError("admin blog insert failed", error, { tag: "admin-blog", severity: "warning" });
      return { error: "حدث خطأ أثناء الإنشاء" };
    }
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
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
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function savePost(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id") as string | null;
  const isPublished = formData.get("action") === "publish";

  const row = {
    slug: formData.get("slug") as string,
    title_ar: formData.get("title_ar") as string,
    title_en: formData.get("title_en") as string,
    excerpt_ar: formData.get("excerpt_ar") as string,
    excerpt_en: formData.get("excerpt_en") as string,
    body_ar: formData.get("body_ar") as string,
    body_en: formData.get("body_en") as string,
    category_ar: formData.get("category_ar") as string,
    category_en: formData.get("category_en") as string,
    color: formData.get("color") as string,
    read_time_ar: formData.get("read_time_ar") as string,
    read_time_en: formData.get("read_time_en") as string,
    is_published: isPublished,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.from("blog_posts").update(row as never).eq("id", id);
  } else {
    await supabase.from("blog_posts").insert(row as never);
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  redirect("/admin/blog");
}

export async function deletePost(postId: string) {
  const supabase = await createClient();
  await supabase.from("blog_posts").delete().eq("id", postId);
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { success: true };
}

export async function togglePublished(postId: string, isPublished: boolean) {
  const supabase = await createClient();
  await supabase.from("blog_posts").update({ is_published: isPublished } as never).eq("id", postId);
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { success: true };
}

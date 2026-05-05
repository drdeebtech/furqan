import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { BlogPost } from "@/types/blog";
import { DeletePostButton } from "./delete-button";
import { TogglePublished } from "./toggle-published";

export const metadata: Metadata = { title: "إدارة المدونة" };

export default async function AdminBlogPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("id, slug, title_ar, category_ar, color, is_published, published_at")
    .order("created_at", { ascending: false })
    .returns<Pick<BlogPost, "id" | "slug" | "title_ar" | "category_ar" | "color" | "is_published" | "published_at">[]>();

  const list = posts ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("إدارة المدونة", "Manage Blog")}</h1>
        <Link
          href="/admin/blog/new"
          className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium"
        >
          <Plus size={16} />
          {t("مقال جديد", "New Post")}
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <p className="text-muted">{t("لا توجد مقالات بعد", "No posts yet")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="glass-thead">
                <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("العنوان", "Title")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("التصنيف", "Category")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("تاريخ النشر", "Published")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("إجراءات", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((post) => (
                <tr key={post.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3 font-medium">{post.title_ar}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${post.color}`}>{post.category_ar}</span>
                  </td>
                  <td className="px-4 py-3">
                    <TogglePublished postId={post.id} isPublished={post.is_published} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {new Date(post.published_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/blog/${post.id}/edit`} className="flex items-center gap-1 text-xs text-gold hover:text-gold-light">
                        <Pencil size={12} /> {t("تعديل", "Edit")}
                      </Link>
                      <DeletePostButton postId={post.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

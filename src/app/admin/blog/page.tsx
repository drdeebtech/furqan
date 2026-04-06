import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { DeletePostButton } from "./delete-button";
import { TogglePublished } from "./toggle-published";

export const metadata: Metadata = { title: "إدارة المدونة" };

export default async function AdminBlogPage() {
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
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">إدارة المدونة</h1>
        <Link
          href="/admin/blog/new"
          className="flex items-center gap-2 rounded bg-gold px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-gold-hover"
        >
          <Plus size={16} />
          مقال جديد
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <p className="text-muted">لا توجد مقالات بعد</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card">
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted">العنوان</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted">التصنيف</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الحالة</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted">تاريخ النشر</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {list.map((post) => (
                <tr key={post.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">{post.title_ar}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${post.color}`}>{post.category_ar}</span>
                  </td>
                  <td className="px-4 py-3">
                    <TogglePublished postId={post.id} isPublished={post.is_published} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {new Date(post.published_at).toLocaleDateString("ar-SA")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/blog/${post.id}/edit`} className="flex items-center gap-1 text-xs text-gold hover:text-gold-light">
                        <Pencil size={12} /> تعديل
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

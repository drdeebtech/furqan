import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { PostForm } from "../../post-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPostPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: post } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .single<BlogPost>();

  if (!post) redirect("/admin/blog");

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">تعديل المقال</h1>
      <div className="glass-card rounded-xl p-6">
        <PostForm post={post} />
      </div>
    </div>
  );
}

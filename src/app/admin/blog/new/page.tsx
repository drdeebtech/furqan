import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "مقال جديد" };

export default async function NewPostPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">مقال جديد</h1>
      <div className="rounded-xl border border-card-border bg-card p-6">
        <PostForm />
      </div>
    </div>
  );
}

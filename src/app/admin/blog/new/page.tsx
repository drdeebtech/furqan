import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "مقال جديد" };

export default async function NewPostPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t("مقال جديد", "New Post")}</h1>
      <div className="glass-card rounded-xl p-6">
        <PostForm />
      </div>
    </div>
  );
}

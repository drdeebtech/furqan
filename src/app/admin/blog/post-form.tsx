"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n/context";
import type { BlogPost } from "@/types/blog";
import { savePost } from "./actions";

type State = { error?: string } | null;

const CATEGORIES = [
  { ar: "حفظ القرآن", en: "Hifz" },
  { ar: "تجويد", en: "Tajweed" },
  { ar: "نصائح", en: "Tips" },
  { ar: "للأطفال", en: "Children" },
  { ar: "القراءات", en: "Qiraat" },
  { ar: "تفسير", en: "Tafsir" },
];

const input = "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none";

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function PostForm({ post }: { post?: BlogPost }) {
  const { dir } = useLang();
  const [state, formAction, pending] = useActionState<State, FormData>(
    savePost,
    null,
  );

  return (
    <form action={formAction} className="space-y-5" dir={dir}>
      {post && <input type="hidden" name="id" value={post.id} />}

      {state?.error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="title_ar" className="mb-1 block text-sm font-medium">العنوان بالعربية *</label>
          <input id="title_ar" name="title_ar" required defaultValue={post?.title_ar} className={input} placeholder="عنوان المقال بالعربية" />
        </div>
        <div>
          <label htmlFor="title_en" className="mb-1 block text-sm font-medium">Title in English *</label>
          <input
            id="title_en"
            name="title_en"
            required
            dir="ltr"
            defaultValue={post?.title_en}
            className={input}
            placeholder="Article title in English"
            onChange={(e) => {
              const slugInput = e.target.form?.querySelector<HTMLInputElement>("[name=slug]");
              if (slugInput && !post) slugInput.value = slugify(e.target.value);
            }}
          />
        </div>
      </div>

      <div>
        <label htmlFor="slug" className="mb-1 block text-sm font-medium">الرابط (Slug) *</label>
        <input id="slug" name="slug" required dir="ltr" defaultValue={post?.slug} className={`${input} text-left`} placeholder="article-url-slug" />
        <p className="mt-1 text-xs text-muted">يُستخدم في رابط المقال — أحرف إنجليزية وأرقام وشرطات فقط</p>
      </div>

      <div>
        <label htmlFor="category_en" className="mb-1 block text-sm font-medium">التصنيف *</label>
        <select id="category_en" name="category_en" required defaultValue={post?.category_en} className={input}>
          <option value="">اختر التصنيف</option>
          {CATEGORIES.map((c) => (
            <option key={c.en} value={c.en}>{c.ar} / {c.en}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="read_time_ar" className="mb-1 block text-sm font-medium">وقت القراءة بالعربية</label>
          <input id="read_time_ar" name="read_time_ar" defaultValue={post?.read_time_ar ?? "٥ دقائق"} className={input} placeholder="٥ دقائق" />
        </div>
        <div>
          <label htmlFor="read_time_en" className="mb-1 block text-sm font-medium">Read Time (English)</label>
          <input id="read_time_en" name="read_time_en" dir="ltr" defaultValue={post?.read_time_en ?? "5 min"} className={`${input} text-left`} placeholder="5 min" />
        </div>
      </div>

      <div>
        <label htmlFor="excerpt_ar" className="mb-1 block text-sm font-medium">مقتطف بالعربية *</label>
        <textarea id="excerpt_ar" name="excerpt_ar" required rows={3} defaultValue={post?.excerpt_ar} className={`${input} resize-none`} placeholder="ملخص قصير للمقال بالعربية..." />
      </div>

      <div>
        <label htmlFor="excerpt_en" className="mb-1 block text-sm font-medium">Excerpt in English *</label>
        <textarea id="excerpt_en" name="excerpt_en" required dir="ltr" rows={3} defaultValue={post?.excerpt_en} className={`${input} resize-none text-left`} placeholder="Short summary in English..." />
      </div>

      <div>
        <label htmlFor="body_ar" className="mb-1 block text-sm font-medium">المحتوى الكامل بالعربية *</label>
        <textarea id="body_ar" name="body_ar" required rows={10} defaultValue={post?.body_ar} className={`${input} resize-y`} placeholder="اكتب محتوى المقال بالعربية هنا..." />
      </div>

      <div>
        <label htmlFor="body_en" className="mb-1 block text-sm font-medium">Full Content in English *</label>
        <textarea id="body_en" name="body_en" required dir="ltr" rows={10} defaultValue={post?.body_en} className={`${input} resize-y text-left`} placeholder="Write the full article content here..." />
      </div>

      <div className="flex items-center gap-3 glass-card rounded-xl p-4">
        <input type="checkbox" name="is_published" id="is_published" defaultChecked={post?.is_published} className="h-4 w-4 accent-gold" />
        <label htmlFor="is_published" className="cursor-pointer text-sm font-medium">
          نشر المقال الآن
          <span className="me-2 text-xs text-muted">(إذا تركته بدون تفعيل سيُحفظ كمسودة)</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="w-full glass-gold glass-pill py-3 font-semibold transition-colors disabled:opacity-50"
      >
        {pending ? "جاري الحفظ..." : post ? "حفظ التعديلات" : "حفظ المقال"}
      </button>
    </form>
  );
}

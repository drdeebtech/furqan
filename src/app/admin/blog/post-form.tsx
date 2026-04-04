"use client";

import type { BlogPost } from "@/types/blog";
import { savePost } from "./actions";

const CATEGORIES = [
  { ar: "حفظ القرآن", en: "Hifz", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  { ar: "تجويد", en: "Tajweed", color: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
  { ar: "نصائح", en: "Tips", color: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  { ar: "للأطفال", en: "Children", color: "text-pink-400 border-pink-500/30 bg-pink-500/10" },
  { ar: "القراءات", en: "Qiraat", color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
  { ar: "تفسير", en: "Tafsir", color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
];

const input = "w-full rounded-xl border border-input-border bg-input px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function PostForm({ post }: { post?: BlogPost }) {
  const selectedCat = post ? CATEGORIES.find((c) => c.en === post.category_en) : undefined;

  return (
    <form action={savePost} className="space-y-5" dir="rtl">
      {post && <input type="hidden" name="id" value={post.id} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">العنوان بالعربية</label>
          <input name="title_ar" required defaultValue={post?.title_ar} className={input} placeholder="كيف تبدأ رحلة حفظ القرآن؟" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Title (English)</label>
          <input
            name="title_en"
            required
            defaultValue={post?.title_en}
            className={input}
            dir="ltr"
            placeholder="How to Start Quran Memorization"
            onChange={(e) => {
              const slugInput = e.target.form?.querySelector<HTMLInputElement>("[name=slug]");
              if (slugInput && !post) slugInput.value = slugify(e.target.value);
            }}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">الرابط (Slug)</label>
        <input name="slug" required defaultValue={post?.slug} dir="ltr" className={`${input} text-left`} placeholder="how-to-start-quran-memorization" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">التصنيف</label>
          <select name="category_ar" required defaultValue={post?.category_ar} className={input}
            onChange={(e) => {
              const cat = CATEGORIES.find((c) => c.ar === e.target.value);
              const form = e.target.form;
              if (cat && form) {
                form.querySelector<HTMLInputElement>("[name=category_en]")!.value = cat.en;
                form.querySelector<HTMLInputElement>("[name=color]")!.value = cat.color;
              }
            }}
          >
            <option value="">اختر التصنيف</option>
            {CATEGORIES.map((c) => <option key={c.en} value={c.ar}>{c.ar} ({c.en})</option>)}
          </select>
          <input type="hidden" name="category_en" defaultValue={post?.category_en ?? selectedCat?.en ?? ""} />
          <input type="hidden" name="color" defaultValue={post?.color ?? selectedCat?.color ?? CATEGORIES[0].color} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">وقت القراءة (عربي)</label>
          <input name="read_time_ar" required defaultValue={post?.read_time_ar ?? "٥ دقائق"} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Read time (EN)</label>
          <input name="read_time_en" required defaultValue={post?.read_time_en ?? "5 min"} dir="ltr" className={`${input} text-left`} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">مقتطف بالعربية</label>
          <textarea name="excerpt_ar" required rows={3} defaultValue={post?.excerpt_ar} className={`${input} resize-none`} placeholder="وصف مختصر للمقال..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Excerpt (English)</label>
          <textarea name="excerpt_en" required rows={3} defaultValue={post?.excerpt_en} dir="ltr" className={`${input} resize-none text-left`} placeholder="Brief description..." />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">المحتوى بالعربية</label>
        <textarea name="body_ar" required rows={10} defaultValue={post?.body_ar} className={`${input} resize-y`} placeholder="اكتب المقال الكامل هنا..." />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Content (English)</label>
        <textarea name="body_en" required rows={10} defaultValue={post?.body_en} dir="ltr" className={`${input} resize-y text-left`} placeholder="Write the full article here..." />
      </div>

      <div className="flex gap-3 border-t border-card-border pt-5">
        <button type="submit" name="action" value="draft" className="rounded border border-card-border px-6 py-2.5 text-sm font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground">
          حفظ كمسودة
        </button>
        <button type="submit" name="action" value="publish" className="rounded bg-gold px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-gold-hover">
          نشر المقال
        </button>
      </div>
    </form>
  );
}

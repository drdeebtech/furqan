import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { createThread } from "@/lib/actions/community";
import { getDashboardHref } from "@/lib/auth/dashboard-href";

export const metadata: Metadata = { title: "موضوع جديد" };

export default async function NewThreadPage() {
  if (!(await isFeatureEnabled("community_enabled"))) notFound();

  const { t } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const dashboardHref = await getDashboardHref(supabase);

  async function action(formData: FormData) {
    "use server";
    const res = await createThread(formData);
    if (res.ok && res.id) redirect(`/community/${res.id}`);
    redirect("/community");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {dashboardHref && (
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-card-border/60 pb-4 text-sm">
          <span className="text-muted">
            {t("المجتمع — يمكنك العودة إلى لوحة التحكم في أي وقت.",
               "Community — return to your dashboard anytime.")}
          </span>
          <Link href={dashboardHref} className="shrink-0 font-medium text-gold hover:text-gold-hover focus-ring rounded">
            {t("العودة للوحة التحكم", "Back to dashboard")}
          </Link>
        </div>
      )}
      <h1 className="mb-6 font-display text-xl font-bold sm:text-2xl">موضوع جديد · New Thread</h1>
      <form action={action} className="glass-card space-y-3 p-6">
        <input required name="title_ar" placeholder="العنوان بالعربية *" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        <input name="title_en" placeholder="Title (English)" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        <textarea required name="body_ar" rows={6} placeholder="المحتوى بالعربية *" className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed" />
        <textarea name="body_en" rows={6} placeholder="Content (English)" className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed" />
        <select name="category" defaultValue="general" className="glass-input h-10 w-full rounded-lg px-2 text-sm">
          <option value="general">عام · General</option>
          <option value="hifz">الحفظ · Memorization</option>
          <option value="tajweed">التجويد · Tajweed</option>
          <option value="advice">نصائح · Advice</option>
          <option value="resources">مصادر · Resources</option>
        </select>
        <button type="submit" className="glass-gold glass-pill px-6 py-2 text-sm font-semibold">نشر · Post</button>
      </form>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { createCourse } from "@/lib/actions/courses";

export const metadata: Metadata = { title: "دورة جديدة" };

export default async function NewCoursePage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (
    !profile ||
    !["admin", "moderator", "teacher"].includes(profile.role)
  ) {
    redirect("/login");
  }

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/teacher/courses" className="hover:text-gold">
          {t("الدورات المسجلة", "Recorded Courses")}
        </Link>
        <ChevronRight size={14} className={dir === "rtl" ? "rotate-180" : ""} />
        <span>{t("دورة جديدة", "New course")}</span>
      </div>

      <h1 className="mb-6 text-xl font-bold">{t("إنشاء دورة جديدة", "Create a new course")}</h1>

      <form
        action={async (fd) => {
          "use server";
          await createCourse(fd);
        }}
        className="glass-card space-y-5 p-6"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="title_ar">
            {t("عنوان الدورة (عربي)", "Course title (Arabic)")} *
          </label>
          <input
            id="title_ar"
            name="title_ar"
            required
            maxLength={120}
            className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
            placeholder={t("مثال: التجويد للمبتدئين", "e.g. Tajweed for Beginners")}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="title_en">
            {t("العنوان (إنجليزي — اختياري)", "Title (English — optional)")}
          </label>
          <input
            id="title_en"
            name="title_en"
            maxLength={120}
            className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
            placeholder="Tajweed for Beginners"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="description_ar">
            {t("وصف الدورة (عربي)", "Description (Arabic)")}
          </label>
          <textarea
            id="description_ar"
            name="description_ar"
            rows={4}
            className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="level">
              {t("المستوى", "Level")}
            </label>
            <select
              id="level"
              name="level"
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
              defaultValue=""
            >
              <option value="">—</option>
              <option value="beginner">{t("مبتدئ", "Beginner")}</option>
              <option value="intermediate">{t("متوسط", "Intermediate")}</option>
              <option value="advanced">{t("متقدم", "Advanced")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="language">
              {t("لغة الدورة", "Language")}
            </label>
            <select
              id="language"
              name="language"
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
              defaultValue="ar"
            >
              <option value="ar">{t("العربية", "Arabic")}</option>
              <option value="en">{t("الإنجليزية", "English")}</option>
              <option value="both">{t("ثنائية", "Both")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="specialty">
              {t("التخصص", "Specialty")}
            </label>
            <select
              id="specialty"
              name="specialty"
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
              defaultValue=""
            >
              <option value="">—</option>
              <option value="tajweed">{t("تجويد", "Tajweed")}</option>
              <option value="hifz">{t("حفظ", "Hifz")}</option>
              <option value="ijazah">{t("إجازة", "Ijazah")}</option>
              <option value="arabic">{t("عربية", "Arabic")}</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border bg-white/20 p-4 dark:bg-white/5">
          <div className="mb-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="pricing_type"
                value="free"
                defaultChecked
              />
              {t("مجانية", "Free")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="pricing_type" value="one_time" />
              {t("مدفوعة (شراء لمرة واحدة)", "Paid (one-time purchase)")}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" htmlFor="price_cents">
                {t("السعر (بالقروش/سنت)", "Price (cents)")}
              </label>
              <input
                id="price_cents"
                name="price_cents"
                type="number"
                min={0}
                defaultValue={0}
                className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" htmlFor="currency">
                {t("العملة", "Currency")}
              </label>
              <select
                id="currency"
                name="currency"
                className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
                defaultValue="USD"
              >
                <option value="USD">USD</option>
                <option value="EGP">EGP</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            {t(
              "100 قرش = 1 جنيه. السعر $9.99 = 999 سنت. السعر 100 جنيه = 10000 قرش.",
              "100 cents = $1. $9.99 = 999 cents. 100 EGP = 10000 piasters.",
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            {t("إنشاء الدورة", "Create course")}
          </button>
          <Link
            href="/teacher/courses"
            className="text-sm text-muted hover:text-foreground"
          >
            {t("إلغاء", "Cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}

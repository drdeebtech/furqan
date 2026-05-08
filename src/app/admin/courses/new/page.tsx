import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { createCourse } from "@/lib/actions/courses";
import { OwnershipFieldset } from "./ownership-fieldset";

export const metadata: Metadata = { title: "دورة مسجلة جديدة" };

export default async function AdminNewCoursePage() {
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
  if (!profile || !["admin"].includes(profile.role)) {
    redirect("/login");
  }

  // Pull the active teacher list so the staff member can assign the course
  // to its owning teacher. Sort by full_name for predictability.
  // email lives on auth.users, not public.profiles — drop from select to
  // stop PGRST 42703 (Sentry E4-18). Use admin.auth.admin.listUsers() if
  // email is needed for display.
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "teacher")
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .returns<{ id: string; full_name: string | null }[]>();

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-8">
      <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/courses" className="hover:text-gold focus-ring rounded">
          {t("الدورات المسجلة", "Recorded Courses")}
        </Link>
        <ChevronRight size={14} className={dir === "rtl" ? "rotate-180" : ""} aria-hidden="true" />
        <span>{t("دورة جديدة", "New course")}</span>
      </nav>

      <h1 className="mb-1 font-display text-2xl font-bold sm:text-3xl">
        {t("إنشاء دورة جديدة", "Create a new course")}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {t(
          "يمكن أن تكون الدورة مملوكة للمنصة (الإيراد بالكامل للمنصة) أو مسندة لمعلم (الإيراد مشترك معه).",
          "Courses can belong to the platform (100% platform revenue) or to a specific teacher (revenue shared with them).",
        )}
      </p>

      <form
        action={async (fd) => {
          "use server";
          await createCourse(fd);
        }}
        className="glass-card space-y-5 p-6"
      >
        <OwnershipFieldset
          teachers={teachers ?? []}
          labels={{
            ownership: t("نوع ملكية الدورة", "Course ownership"),
            platform: t("دورة المنصة", "Platform-owned"),
            platformHint: t(
              "تنشرها المنصة؛ ١٠٠٪ من الإيراد للمنصة.",
              "Published by the platform; 100% of revenue goes to the platform.",
            ),
            teacher: t("دورة معلم", "Teacher-owned"),
            teacherHint: t(
              "مرتبطة بمعلم محدد؛ الإيراد مشترك معه.",
              "Tied to a specific teacher; revenue is shared with them.",
            ),
            selectTeacher: t("المعلم المالك", "Owning teacher"),
            selectTeacherPlaceholder: t("اختر المعلم…", "Select a teacher…"),
            noTeachers: t("لا يوجد معلمون مسجلون بعد", "No teachers registered yet"),
          }}
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="title_ar">
            {t("عنوان الدورة (عربي)", "Course title (Arabic)")} *
          </label>
          <input
            id="title_ar"
            name="title_ar"
            required
            maxLength={120}
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
              defaultValue=""
              className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
              defaultValue="ar"
              className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
              defaultValue=""
              className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
            >
              <option value="">—</option>
              <option value="tajweed">{t("تجويد", "Tajweed")}</option>
              <option value="hifz">{t("حفظ", "Hifz")}</option>
              <option value="ijazah">{t("إجازة", "Ijazah")}</option>
              <option value="arabic">{t("عربية", "Arabic")}</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--surface-border)] bg-surface/40 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="pricing_type" value="free" defaultChecked />
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
                className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" htmlFor="currency">
                {t("العملة", "Currency")}
              </label>
              <select
                id="currency"
                name="currency"
                defaultValue="USD"
                className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
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
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-background transition hover:bg-gold-hover focus-ring"
          >
            {t("إنشاء الدورة", "Create course")}
          </button>
          <Link
            href="/admin/courses"
            className="text-sm text-muted hover:text-foreground focus-ring rounded"
          >
            {t("إلغاء", "Cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}

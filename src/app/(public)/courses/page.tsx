import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Building2, GraduationCap, Inbox, Star } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import type { Course } from "@/types/database";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "الدورات المسجلة",
  description: "تصفح الدورات المسجلة من معلمي فرقان — تجويد، حفظ، إجازة، عربية.",
  // Canonical collapses all ?specialty/?level/?pricing filter variants under one URL.
  alternates: { canonical: "https://www.furqan.today/courses" },
};

interface SearchParams {
  specialty?: string;
  level?: string;
  language?: string;
  pricing?: string;
  sort?: string;
}

export default async function PublicCoursesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { t, dir } = await getT();
  const paidCoursesEnabled = await isFeatureEnabled("paid_courses_enabled");
  // Use admin client for SSR public catalog so we don't depend on a session.
  // RLS still permits anon SELECT on status='published'.
  // admin: public anonymous read of published courses (issue #523)
  const supabase = createAdminClient();

  let q = supabase
    .from("courses")
    .select(
      "id, slug, title_ar, title_en, description_ar, cover_image_url, pricing_type, price_cents, currency, level, language, specialty, lesson_count_cached, enrollment_count_cached, rating_avg_cached, rating_count_cached, published_at, teacher_id, ownership",
    )
    .eq("status", "published")
    .is("deleted_at", null);

  if (sp.specialty) q = q.eq("specialty", sp.specialty);
  if (sp.level) q = q.eq("level", sp.level);
  if (sp.language) q = q.eq("language", sp.language);
  if (sp.pricing === "free") q = q.eq("pricing_type", "free");
  if (sp.pricing === "paid") q = q.eq("pricing_type", "one_time");

  if (sp.sort === "popular") {
    q = q.order("enrollment_count_cached", { ascending: false });
  } else if (sp.sort === "rating") {
    q = q.order("rating_avg_cached", { ascending: false, nullsFirst: false });
  } else {
    q = q.order("published_at", { ascending: false });
  }

  const { data: courses } = await q.limit(50).returns<
    Pick<
      Course,
      | "id"
      | "slug"
      | "title_ar"
      | "title_en"
      | "description_ar"
      | "cover_image_url"
      | "pricing_type"
      | "price_cents"
      | "currency"
      | "level"
      | "language"
      | "specialty"
      | "lesson_count_cached"
      | "enrollment_count_cached"
      | "rating_avg_cached"
      | "rating_count_cached"
      | "published_at"
      | "teacher_id"
      | "ownership"
    >[]
  >();

  const teacherIds = [
    ...new Set(
      (courses ?? [])
        .map((c) => c.teacher_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const tc of teachers ?? []) {
      nameMap[tc.id] = tc.full_name ?? "—";
    }
  }

  const FILTER_TABS = [
    { key: "specialty", value: "", label: t("الكل", "All") },
    { key: "specialty", value: "tajweed", label: t("تجويد", "Tajweed") },
    { key: "specialty", value: "hifz", label: t("حفظ", "Hifz") },
    { key: "specialty", value: "ijazah", label: t("إجازة", "Ijazah") },
    { key: "specialty", value: "arabic", label: t("عربية", "Arabic") },
  ];

  function buildHref(overrides: Record<string, string>) {
    const merged = { ...sp, ...overrides };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) usp.set(k, String(v));
    }
    const qs = usp.toString();
    return qs ? `/courses?${qs}` : "/courses";
  }

  return (
    <div dir={dir}>
      <BreadcrumbSchema
        items={[
          { name: t("الرئيسية", "Home"), url: "https://www.furqan.today" },
          { name: t("الدورات", "Courses"), url: "https://www.furqan.today/courses" },
        ]}
      />
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-12 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="text-xs text-muted-light">
            <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">{t("الرئيسية", "Home")}</Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">/</span>
            <span className="text-muted">{t("الدورات", "Courses")}</span>
          </nav>
          <div className="mt-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10">
            <GraduationCap size={22} className="text-gold" aria-hidden="true" />
          </div>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">{t("الدورات المسجلة", "Recorded Courses")}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "تعلّم على وتيرتك من معلمين معتمدين — تجويد، حفظ، إجازة، عربية.",
              "Learn at your own pace from certified teachers — Tajweed, Hifz, Ijazah, Arabic.",
            )}
          </p>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="sr-only">{t("الدورات", "Courses")}</h2>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTER_TABS.map((f) => {
          const active = (sp.specialty ?? "") === f.value;
          return (
            <Link
              key={`${f.key}-${f.value}`}
              href={buildHref({ [f.key]: f.value })}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-gold text-background"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 text-muted">|</span>
        {[
          { value: "", label: t("الكل", "All") },
          { value: "free", label: t("مجاني", "Free") },
          { value: "paid", label: t("مدفوع", "Paid") },
        ].map((p) => {
          const active = (sp.pricing ?? "") === p.value;
          return (
            <Link
              key={`p-${p.value}`}
              href={buildHref({ pricing: p.value })}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-gold text-background"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {!courses || courses.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">
            {t("لا توجد دورات منشورة بعد", "No published courses yet")}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/courses/${c.slug}`}
              className="glass-card overflow-hidden transition hover:scale-[1.01] hover:bg-white/40 dark:hover:bg-white/5"
            >
              {c.cover_image_url ? (
                <Image
                  src={c.cover_image_url}
                  alt={c.title_ar ?? c.title_en ?? ""}
                  width={640}
                  height={360}
                  className="aspect-video w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="aspect-video w-full bg-gradient-to-br from-gold/30 to-gold/5" />
              )}
              <div className="p-4">
                <h2 className="text-base font-semibold leading-tight">{c.title_ar}</h2>
                {c.description_ar && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted">{c.description_ar}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {c.ownership === "platform" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 font-medium text-gold">
                      <Building2 size={11} aria-hidden="true" />
                      {t("أكاديمية فرقان", "FURQAN Academy")}
                    </span>
                  ) : (
                    <span className="text-muted">
                      {(c.teacher_id && nameMap[c.teacher_id]) || "—"}
                    </span>
                  )}
                  <span className="text-muted">·</span>
                  <span className="text-muted">
                    {c.lesson_count_cached ?? 0} {t("درس", "lessons")}
                  </span>
                  {c.rating_count_cached && c.rating_count_cached > 0 ? (
                    <>
                      <span className="text-muted">·</span>
                      <span className="flex items-center gap-1 text-warning">
                        <Star size={11} fill="currentColor" />
                        {c.rating_avg_cached?.toFixed(1)}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {c.pricing_type === "free" ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
                      {t("مجاني", "Free")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold text-gold">
                      {(c.price_cents / 100).toFixed(2)} {c.currency}
                      {!paidCoursesEnabled && ` · ${t("قريباً", "Coming soon")}`}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
